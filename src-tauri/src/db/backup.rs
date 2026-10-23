use super::*;
use serde::de::{Deserialize, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use std::{
    cell::Cell,
    fmt,
    io::{BufReader, Read, Write},
    rc::Rc,
};
fn bounded_array<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a Vec<Value>> {
    let a = v[key]
        .as_array()
        .ok_or_else(|| format!("Invalid backup {key}"))?;
    if a.len() > max {
        return Err(format!("Backup has too many {key}"));
    }
    Ok(a)
}
fn keys(v: &Value, allowed: &[&str]) -> Result<()> {
    let o = v.as_object().ok_or("Expected backup object")?;
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("Unknown or secret field in backup".into());
    }
    Ok(())
}
fn timestamp(v: &Value) -> Result<()> {
    if v.as_i64()
        .is_none_or(|t| !(0..=32_503_680_000).contains(&t))
    {
        return Err("Invalid backup timestamp".into());
    }
    Ok(())
}
fn safe_text(v: &Value, key: &str, max: usize) -> Result<()> {
    if v[key]
        .as_str()
        .is_none_or(|s| s.len() > max || s.contains('\0'))
    {
        return Err(format!("Invalid backup {key}"));
    }
    Ok(())
}
// A record can occupy the entire legacy 32 MiB backup, including optional
// source notes. Bound before parsing; the native file has no aggregate byte cap.
const MAX_RECORD_BYTES: usize = 32 * 1024 * 1024;
// Refresh may be interrupted before retention. Stream the actual article/state
// rows; indexed SQLite references replace an aggregate count and in-memory set.
const SECTION_LIMITS: [Option<usize>; 4] =
    [Some(5000), None, None, Some(32 * 3 * (90 * 24 * 6 + 1))];
const SECTIONS: [&str; 4] = ["documents", "articles", "states", "alerts"];

#[derive(Default)]
struct Validator {
    profiles: HashSet<String>,
    sources: std::collections::HashMap<String, Value>,
    providers: HashSet<String>,
    workspaces: HashSet<String>,
    identities: HashSet<(String, String, String)>,
    watch_counts: std::collections::HashMap<String, usize>,
    saved_ids: HashSet<String>,
    counts: [usize; 4],
}

// serde_json::Value accepts duplicate keys; a backup must have one meaning.
struct StrictValue(Value);
impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = StrictValue;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON value")
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                v: bool,
            ) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(Value::String(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<StrictValue, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<StrictValue, A::Error> {
                let mut values = Vec::new();
                while let Some(StrictValue(v)) = a.next_element()? {
                    values.push(v);
                }
                Ok(StrictValue(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<StrictValue, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some(key) = a.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom("Duplicate backup key"));
                    }
                    values.insert(key, a.next_value::<StrictValue>()?.0);
                }
                Ok(StrictValue(Value::Object(values)))
            }
        }
        d.deserialize_any(JsonVisitor)
    }
}

struct RecordRead<R> {
    reader: R,
    remaining: Rc<Cell<usize>>,
}
impl<R: Read> Read for RecordRead<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let allowed = buffer.len().min(self.remaining.get());
        if allowed == 0 {
            let mut probe = [0];
            if self.reader.read(&mut probe)? == 0 {
                return Ok(0);
            }
            return Err(std::io::Error::other("Backup record exceeds 32 MiB"));
        }
        let n = self.reader.read(&mut buffer[..allowed])?;
        self.remaining.set(self.remaining.get() - n);
        Ok(n)
    }
}

pub(super) struct StagedBackup {
    conn: Connection,
    _file: tempfile::NamedTempFile,
}
impl StagedBackup {
    pub(super) fn read<R: Read>(reader: R) -> Result<Self> {
        let file =
            tempfile::NamedTempFile::new().map_err(|e| format!("Cannot stage backup: {e}"))?;
        let staged = Self {
            conn: Connection::open(file.path()).map_err(sql)?,
            _file: file,
        };
        staged.conn.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-4096;
            CREATE TABLE records(section INTEGER NOT NULL,k1 TEXT NOT NULL,k2 TEXT NOT NULL,k3 TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(section,k1,k2,k3)) WITHOUT ROWID;
            BEGIN IMMEDIATE;").map_err(sql)?;
        let remaining = Rc::new(Cell::new(MAX_RECORD_BYTES));
        let mut deserializer = serde_json::Deserializer::from_reader(RecordRead {
            reader: BufReader::new(reader),
            remaining: remaining.clone(),
        });
        Header {
            staged: &staged,
            remaining,
        }
        .deserialize(&mut deserializer)
        .map_err(parse_error)?;
        deserializer.end().map_err(parse_error)?;
        staged.conn.execute_batch("COMMIT").map_err(sql)?;
        let mut validator = Validator::default();
        for section in 0..SECTIONS.len() {
            staged.for_each(section, |value| validator.record(section, &value))?;
            if section == 0 {
                validator.finish_documents()?;
            }
        }
        let invalid_reference: bool = staged.conn.query_row("SELECT EXISTS(SELECT 1 FROM records s WHERE s.section=2 AND NOT EXISTS(SELECT 1 FROM records a WHERE a.section=1 AND a.k1=s.k2 AND a.k2='' AND a.k3=''))", [], |row| row.get(0)).map_err(sql)?;
        if invalid_reference {
            return Err("Invalid state reference".into());
        }
        Ok(staged)
    }
    pub(super) fn for_each(
        &self,
        section: usize,
        mut visit: impl FnMut(Value) -> Result<()>,
    ) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM records WHERE section=?1 ORDER BY k1,k2,k3")
            .map_err(sql)?;
        let rows = stmt
            .query_map([section], |row| row.get::<_, String>(0))
            .map_err(sql)?;
        for row in rows {
            visit(serde_json::from_str(&row.map_err(sql)?).map_err(|_| "Corrupt staged backup")?)?;
        }
        Ok(())
    }
    fn insert(&self, section: usize, value: &Value) -> Result<()> {
        match section {
            0 => Validator::default().document(value)?,
            1 => article_fields(value)?,
            2 => state_fields(value)?,
            3 => alert_fields(value)?,
            _ => unreachable!(),
        }
        let (k1, k2, k3) = match section {
            0 => {
                keys(value, &["kind", "id", "scope", "data"])?;
                safe_text(value, "scope", 200)?;
                (
                    text(value, "kind", 30)?,
                    text(value, "id", 200)?,
                    value["scope"].as_str().unwrap(),
                )
            }
            1 => (text(value, "id", 200)?, "", ""),
            _ => (
                text(value, "profileId", 200)?,
                text(value, "articleId", 200)?,
                "",
            ),
        };
        self.conn.execute("INSERT INTO records VALUES(?1,?2,?3,?4,?5)", params![section,k1,k2,k3,value.to_string()]).map_err(|e| {
            if matches!(e, rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation) {
                format!("Duplicate backup {} record", SECTIONS[section])
            } else { sql(e) }
        })?;
        Ok(())
    }
}
fn parse_error(e: serde_json::Error) -> String {
    if e.is_syntax() || e.is_eof() {
        "Invalid backup JSON".into()
    } else {
        e.to_string()
    }
}
struct Header<'a> {
    staged: &'a StagedBackup,
    remaining: Rc<Cell<usize>>,
}
impl<'de> DeserializeSeed<'de> for Header<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        d.deserialize_map(self)
    }
}
impl<'de> Visitor<'de> for Header<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("v1 backup object")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        let mut seen = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !seen.insert(key.clone()) {
                return Err(serde::de::Error::custom("Duplicate backup key"));
            }
            if key == "version" {
                if map.next_value::<StrictValue>()?.0 != 1 {
                    return Err(serde::de::Error::custom("Unsupported backup version"));
                }
            } else {
                let section = SECTIONS
                    .iter()
                    .position(|name| *name == key)
                    .ok_or_else(|| serde::de::Error::custom("Unknown or secret field in backup"))?;
                map.next_value_seed(Records {
                    staged: self.staged,
                    remaining: self.remaining.clone(),
                    section,
                })?;
            }
        }
        if seen.len() != 5 || !seen.contains("version") {
            return Err(serde::de::Error::custom("Backup missing required records"));
        }
        Ok(())
    }
}
struct Records<'a> {
    staged: &'a StagedBackup,
    remaining: Rc<Cell<usize>>,
    section: usize,
}
impl<'de> DeserializeSeed<'de> for Records<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        d.deserialize_seq(self)
    }
}
impl<'de> Visitor<'de> for Records<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("backup records")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> std::result::Result<(), A::Error> {
        let mut count = 0;
        loop {
            self.remaining.set(MAX_RECORD_BYTES);
            let Some(StrictValue(value)) = sequence.next_element()? else {
                break;
            };
            if let Some(limit) = SECTION_LIMITS[self.section] {
                count += 1;
                if count > limit {
                    return Err(serde::de::Error::custom(format!(
                        "Backup has too many {}",
                        SECTIONS[self.section]
                    )));
                }
            }
            self.staged
                .insert(self.section, &value)
                .map_err(serde::de::Error::custom)?;
        }
        Ok(())
    }
}

pub(super) fn export<W: Write>(conn: &Connection, mut writer: W) -> Result<()> {
    let invalid_identity: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM articles WHERE id IS NOT json_extract(data,'$.id'))",
            [],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if invalid_identity {
        return Err("Invalid article identity".into());
    }
    let invalid_reference: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM states s LEFT JOIN articles a ON a.id=s.article_id WHERE a.id IS NULL)", [], |row| row.get(0)).map_err(sql)?;
    if invalid_reference {
        return Err("Invalid state reference".into());
    }
    let queries = [
        "SELECT json_object('kind',kind,'id',id,'scope',scope,'data',json(data)) FROM documents ORDER BY kind,id,scope",
        "SELECT data FROM articles ORDER BY id",
        "SELECT json_object('profileId',profile_id,'articleId',article_id,'data',json(data)) FROM states ORDER BY profile_id,article_id",
        "SELECT json_object('profileId',profile_id,'articleId',article_id,'at',at) FROM alert_log ORDER BY profile_id,article_id",
    ];
    let mut validator = Validator::default();
    writer
        .write_all(b"{\"version\":1")
        .map_err(|e| format!("Cannot write backup: {e}"))?;
    for section in 0..SECTIONS.len() {
        write!(writer, ",\"{}\":[", SECTIONS[section])
            .map_err(|e| format!("Cannot write backup: {e}"))?;
        let mut stmt = conn.prepare(queries[section]).map_err(sql)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql)?;
        for (index, row) in rows.enumerate() {
            let raw = row.map_err(sql)?;
            if raw.len() > MAX_RECORD_BYTES {
                return Err("Backup record exceeds 32 MiB".into());
            }
            let value: Value =
                serde_json::from_str(&raw).map_err(|_| "Corrupt local backup record")?;
            validator.record(section, &value)?;
            if index > 0 {
                writer
                    .write_all(b",")
                    .map_err(|e| format!("Cannot write backup: {e}"))?;
            }
            serde_json::to_writer(&mut writer, &value)
                .map_err(|e| format!("Cannot write backup: {e}"))?;
        }
        if section == 0 {
            validator.finish_documents()?;
        }
        writer
            .write_all(b"]")
            .map_err(|e| format!("Cannot write backup: {e}"))?;
    }
    writer
        .write_all(b"}")
        .map_err(|e| format!("Cannot write backup: {e}"))
}
impl Validator {
    fn record(&mut self, section: usize, value: &Value) -> Result<()> {
        if let Some(limit) = SECTION_LIMITS[section] {
            self.counts[section] += 1;
            if self.counts[section] > limit {
                return Err(format!("Backup has too many {}", SECTIONS[section]));
            }
        }
        match section {
            0 => self.document(value),
            1 => self.article(value),
            2 => self.state(value),
            3 => self.alert(value),
            _ => unreachable!(),
        }
    }
    fn document(&mut self, d: &Value) -> Result<()> {
        keys(d, &["kind", "id", "scope", "data"])?;
        let kind = text(d, "kind", 30)?;
        let id = text(d, "id", 200)?;
        safe_text(d, "scope", 200)?;
        let scope = d["scope"].as_str().unwrap();
        if !self
            .identities
            .insert((kind.to_owned(), id.to_owned(), scope.to_owned()))
        {
            return Err("Duplicate backup record".into());
        }
        if kind != "watchlist" && !scope.is_empty() {
            return Err("Invalid backup scope".into());
        }
        let v = &d["data"];
        match kind {
            "profile" => {
                keys(
                    v,
                    &[
                        "id",
                        "name",
                        "preferences",
                        "quietHours",
                        "alertsEnabled",
                        "lastVisit",
                        "previousVisit",
                    ],
                )?;
                if v["id"] != id {
                    return Err("Profile identity mismatch".into());
                }
                text(v, "name", 80)?;
                boolean(&v["alertsEnabled"])?;
                timestamp(&v["lastVisit"])?;
                timestamp(&v["previousVisit"])?;
                validate_quiet(&v["quietHours"])?;
                keys(&v["quietHours"], &["enabled", "start", "end"])?;
                let p = &v["preferences"];
                keys(
                    p,
                    &[
                        "topics",
                        "regions",
                        "languages",
                        "sources",
                        "keywords",
                        "excludeKeywords",
                        "diversityCap",
                    ],
                )?;
                for k in [
                    "topics",
                    "regions",
                    "languages",
                    "sources",
                    "keywords",
                    "excludeKeywords",
                ] {
                    strings(&p[k], 100, 100)?;
                }
                if p["diversityCap"]
                    .as_f64()
                    .is_none_or(|c| !(0.1..=1.0).contains(&c))
                {
                    return Err("Invalid diversity cap".into());
                }
                self.profiles.insert(id.to_owned());
            }
            "source" => {
                keys(
                    v,
                    &[
                        "id",
                        "name",
                        "url",
                        "homepage",
                        "kind",
                        "topics",
                        "sectionScope",
                        "region",
                        "language",
                        "enabled",
                        "status",
                        "lastSuccess",
                        "termsUrl",
                        "storage",
                        "etag",
                        "lastModified",
                        "aiAllowed",
                        "mediaAllowed",
                        "rightsPolicy",
                        "refreshMinutes",
                        "lastAttempt",
                        "retryAt",
                        "failures",
                        "reviewedAt",
                        "accessMode",
                        "attribution",
                        "permissionEvidence",
                        "permissionNotes",
                        "notes",
                        "summaryPolicy",
                        "storagePolicy",
                        "reviewDate",
                        "sourceAdapter",
                        "publisher",
                        "imagesAvailable",
                    ],
                )?;
                validate_source(v)?;
                if v["id"] != id {
                    return Err("Source identity mismatch".into());
                }
                if !v["lastSuccess"].is_null() {
                    timestamp(&v["lastSuccess"])?;
                }
                for k in ["lastAttempt", "retryAt"] {
                    if let Some(t) = v.get(k) {
                        timestamp(t)?;
                    }
                }
                if let Some(t) = v.get("aiAllowed") {
                    boolean(t)?;
                }
                for k in ["etag", "lastModified", "status"] {
                    if let Some(t) = v.get(k) {
                        if t.as_str().is_none_or(|s| s.len() > 4096) {
                            return Err("Invalid source status/header".into());
                        }
                    }
                }
                self.sources.insert(id.to_owned(), json!({"storage":v["storage"],"aiAllowed":v["aiAllowed"],"mediaAllowed":v["mediaAllowed"]}));
            }
            "provider" => {
                keys(
                    v,
                    &[
                        "id",
                        "name",
                        "kind",
                        "model",
                        "baseUrl",
                        "enabled",
                        "consented",
                    ],
                )?;
                validate_provider(v)?;
                if v["id"] != id {
                    return Err("Provider identity mismatch".into());
                }
                self.providers.insert(id.to_owned());
            }
            "workspace" => {
                keys(v, &["tabs", "activeTabId", "revision"])?;
                validate_workspace(v)?;
                if v["revision"]
                    .as_u64()
                    .is_none_or(|r| r > MAX_WORKSPACE_REVISION)
                {
                    return Err("Invalid workspace revision".into());
                }
                for t in v["tabs"].as_array().unwrap() {
                    keys(
                        t,
                        &[
                            "id",
                            "title",
                            "topic",
                            "query",
                            "section",
                            "mode",
                            "watchlistId",
                            "selectedId",
                        ],
                    )?;
                }
                self.workspaces.insert(id.to_owned());
            }
            "watchlist" => {
                keys(
                    v,
                    &["id", "name", "keywords", "topics", "sources", "alerts"],
                )?;
                validate_watchlist(v)?;
                if v["id"] != id {
                    return Err("Watchlist identity mismatch".into());
                }
                *self.watch_counts.entry(scope.to_owned()).or_insert(0) += 1;
            }
            "meta" if id == "lastRefresh" => {
                timestamp(v)?;
            }
            _ => return Err("Unknown backup record type".into()),
        }
        Ok(())
    }
    fn finish_documents(&self) -> Result<()> {
        if !self.profiles.contains("default")
            || self.profiles.len() > 32
            || self.sources.len() > MAX_SOURCES
            || !["ollama", "gemini", "groq"]
                .iter()
                .all(|id| self.providers.contains(*id))
            || self.providers.len() > 4
            || self.workspaces != self.profiles
        {
            return Err("Backup missing required records or exceeds limits".into());
        }
        if self
            .watch_counts
            .iter()
            .any(|(p, n)| !self.profiles.contains(p) || *n > 100)
        {
            return Err("Invalid watchlist profile or count".into());
        }

        Ok(())
    }
    fn article(&self, a: &Value) -> Result<()> {
        article_fields(a)?;
        let source = self
            .sources
            .get(text(a, "sourceId", 200)?)
            .ok_or("Unknown article source")?;
        if source["storage"] == "metadata"
            && (a["excerpt"] != ""
                || a["history"]
                    .as_array()
                    .is_some_and(|h| h.iter().any(|h| h["excerpt"] != "")))
        {
            return Err("Backup violates metadata-only storage policy".into());
        }
        if a["aiAllowed"] == true && source["aiAllowed"] != true {
            return Err("Backup violates source AI policy".into());
        }
        if let Some(media) = a.get("media") {
            if !media.as_array().unwrap().is_empty()
                && (source["mediaAllowed"] != true || source["storage"] != "excerpt")
            {
                return Err("Backup violates source media storage permission".into());
            }
        }
        Ok(())
    }
    fn state(&mut self, s: &Value) -> Result<()> {
        state_fields(s)?;
        if !self.profiles.contains(s["profileId"].as_str().unwrap()) {
            return Err("Invalid state reference".into());
        }
        if s["data"]["saved"] == true {
            self.saved_ids
                .insert(s["articleId"].as_str().unwrap().to_owned());
            if self.saved_ids.len() > 15000 {
                return Err("Backup has too many saved stories".into());
            }
        }
        Ok(())
    }
    fn alert(&self, a: &Value) -> Result<()> {
        alert_fields(a)?;
        if !self.profiles.contains(a["profileId"].as_str().unwrap()) {
            return Err("Invalid alert record".into());
        }
        Ok(())
    }
}
fn article_fields(a: &Value) -> Result<()> {
    keys(
        a,
        &[
            "id",
            "sourceId",
            "sourceName",
            "title",
            "url",
            "excerpt",
            "publishedAt",
            "firstSeen",
            "updatedAt",
            "topics",
            "sections",
            "topicLabels",
            "classificationVersion",
            "classificationReasons",
            "region",
            "language",
            "kind",
            "aiAllowed",
            "read",
            "saved",
            "hidden",
            "groupId",
            "reasons",
            "score",
            "history",
            "media",
        ],
    )?;
    text(a, "sourceName", 100)?;
    text(a, "title", 2000)?;
    canonical_url(text(a, "url", 4096)?)?;
    safe_text(a, "excerpt", 16000)?;
    if !a["publishedAt"].is_null() {
        timestamp(&a["publishedAt"])?;
    }
    timestamp(&a["firstSeen"])?;
    timestamp(&a["updatedAt"])?;
    strings(&a["topics"], 100, 100)?;
    if let Some(sections) = a.get("sections") {
        strings(sections, 4, 20)?;
        if sections.as_array().unwrap().iter().any(|section| {
            !["ai", "technology", "stocks", "others"].contains(&section.as_str().unwrap_or(""))
        }) {
            return Err("Invalid article focus section".into());
        }
    }
    if let Some(labels) = a.get("topicLabels") {
        strings(labels, 20, 100)?;
    }
    if let Some(reasons) = a.get("classificationReasons") {
        strings(reasons, 20, 300)?;
    }
    if let Some(version) = a.get("classificationVersion") {
        if version.as_u64().is_none_or(|v| v == 0 || v > 1000) {
            return Err("Invalid article classification version".into());
        }
    }
    text(a, "region", 100)?;
    text(a, "language", 40)?;
    if !["reporting", "discussion", "official notice", "opinion"]
        .contains(&a["kind"].as_str().unwrap_or(""))
    {
        return Err("Invalid article kind".into());
    }
    for k in ["read", "saved", "hidden", "aiAllowed"] {
        boolean(&a[k])?;
    }
    text(a, "groupId", 500)?;
    strings(&a["reasons"], 100, 500)?;
    if a["score"].as_i64().is_none() {
        return Err("Invalid score".into());
    }
    for h in bounded_array(a, "history", 20)? {
        keys(h, &["at", "title", "excerpt"])?;
        timestamp(&h["at"])?;
        text(h, "title", 2000)?;
        safe_text(h, "excerpt", 16000)?;
    }
    if let Some(media) = a.get("media") {
        validate_article_media(media)?;
    }
    text(a, "sourceId", 200)?;
    text(a, "id", 200)?;
    Ok(())
}
fn state_fields(s: &Value) -> Result<()> {
    keys(s, &["profileId", "articleId", "data"])?;
    text(s, "profileId", 200)?;
    text(s, "articleId", 200)?;
    keys(&s["data"], &["read", "saved", "hidden", "groupId"])?;
    for k in ["read", "saved", "hidden"] {
        boolean(&s["data"][k])?;
    }
    if let Some(g) = s["data"].get("groupId") {
        if g.as_str().is_none_or(|s| s.len() > 500) {
            return Err("Invalid split group".into());
        }
    }
    Ok(())
}
fn alert_fields(a: &Value) -> Result<()> {
    keys(a, &["profileId", "articleId", "at"])?;
    text(a, "profileId", 200)?;
    text(a, "articleId", 200)?;
    timestamp(&a["at"])?;
    Ok(())
}
