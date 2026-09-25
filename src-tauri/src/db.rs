#[path = "db/backup.rs"]
mod backup;
use crate::rights;
use backup::validate_backup;
#[cfg(test)]
#[path = "../tests/rights/rights_database.rs"]
mod rights_tests;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path, time::Duration};

pub type Result<T> = std::result::Result<T, String>;
const MAX_WORKSPACE_REVISION: u64 = 9_007_199_254_740_990;
pub const MAX_SOURCES: usize = 300;
fn sql(e: rusqlite::Error) -> String {
    format!("Local database error: {e}")
}
pub fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let s = v[key]
        .as_str()
        .ok_or_else(|| format!("Missing or invalid {key}"))?;
    if s.trim().is_empty() || s.len() > max || s.contains('\0') {
        return Err(format!("Invalid {key} length/content"));
    }
    Ok(s)
}
fn strings(v: &Value, max: usize, len: usize) -> Result<()> {
    let a = v.as_array().ok_or("Expected a list")?;
    if a.len() > max {
        return Err("Too many list entries".into());
    }
    for s in a {
        if s.as_str()
            .is_none_or(|s| s.trim().is_empty() || s.len() > len || s.contains('\0'))
        {
            return Err("Invalid list entry".into());
        }
    }
    Ok(())
}
pub fn canonical_url(s: &str) -> Result<String> {
    let mut u = url::Url::parse(s).map_err(|_| "Invalid URL")?;
    if !["http", "https"].contains(&u.scheme())
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Only HTTP(S) URLs without credentials are supported".into());
    }
    u.set_fragment(None);
    let pairs = u
        .query_pairs()
        .filter(|(k, _)| {
            !k.to_ascii_lowercase().starts_with("utm_")
                && !["fbclid", "gclid", "mc_cid", "mc_eid"].contains(&k.as_ref())
        })
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect::<Vec<_>>();
    u.set_query(None);
    if !pairs.is_empty() {
        u.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(u.to_string())
}
pub fn validate_provider(v: &Value) -> Result<()> {
    let id = text(v, "id", 20)?;
    let kind = text(v, "kind", 20)?;
    if id != kind || !["ollama", "gemini", "groq"].contains(&kind) {
        return Err("Unsupported provider".into());
    }
    text(v, "name", 100)?;
    text(v, "model", 200)?;
    boolean(&v["enabled"])?;
    boolean(&v["consented"])?;
    Ok(())
}
fn validate_watchlist(w: &Value) -> Result<()> {
    text(w, "name", 100)?;
    for k in ["keywords", "topics", "sources"] {
        strings(&w[k], 100, 200)?;
    }
    boolean(&w["alerts"])?;
    Ok(())
}
fn allowed_keys(v: &Value, allowed: &[&str]) -> Result<()> {
    if v.as_object()
        .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return Err("Unknown or invalid fields".into());
    }
    Ok(())
}
fn validate_workspace(w: &Value) -> Result<()> {
    allowed_keys(w, &["tabs", "activeTabId", "revision"])?;
    let tabs = w["tabs"].as_array().ok_or("Invalid workspace tabs")?;
    if tabs.is_empty() || tabs.len() > 50 {
        return Err("Workspace must contain 1 to 50 tabs".into());
    }
    let mut ids = HashSet::new();
    for t in tabs {
        allowed_keys(
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
        let id = text(t, "id", 200)?;
        if !ids.insert(id) {
            return Err("Duplicate workspace tab".into());
        }
        text(t, "title", 100)?;
        for k in ["topic", "query"] {
            if t[k].as_str().is_none_or(|s| s.len() > 500) {
                return Err("Invalid tab filter".into());
            }
        }
        if let Some(section) = t.get("section") {
            if !section.is_null()
                && !["ai", "technology", "stocks", "others"]
                    .contains(&section.as_str().unwrap_or(""))
            {
                return Err("Invalid tab section".into());
            }
        }
        if ![
            "all",
            "saved",
            "brief",
            "watchlist",
            "briefing",
            "live",
            "hidden",
        ]
        .contains(&t["mode"].as_str().unwrap_or(""))
        {
            return Err("Invalid tab mode".into());
        }
        for k in ["watchlistId", "selectedId"] {
            if let Some(v) = t.get(k) {
                if !v.is_null() && v.as_str().is_none_or(|s| s.len() > 200) {
                    return Err("Invalid tab reference".into());
                }
            }
        }
    }
    if !ids.contains(text(w, "activeTabId", 200)?) {
        return Err("Active tab is missing".into());
    }
    Ok(())
}
fn validate_source(s: &Value) -> Result<()> {
    if let Some(policy) = s.get("rightsPolicy") {
        crate::rights::validate_policy(policy)?;
    }
    text(s, "id", 200)?;
    text(s, "name", 100)?;
    canonical_url(text(s, "url", 4096)?)?;
    canonical_url(text(s, "homepage", 4096)?)?;
    canonical_url(text(s, "termsUrl", 4096)?)?;
    strings(&s["topics"], 100, 100)?;
    if let Some(scope) = s.get("sectionScope") {
        strings(scope, 4, 20)?;
        if scope.as_array().unwrap().iter().any(|section| {
            !["ai", "technology", "stocks", "others"].contains(&section.as_str().unwrap_or(""))
        }) {
            return Err("Invalid source section scope".into());
        }
    }
    text(s, "region", 100)?;
    text(s, "language", 40)?;
    boolean(&s["enabled"])?;
    if let Some(permission) = s.get("mediaAllowed") {
        boolean(permission)?;
    }
    if !["reporting", "discussion", "official notice", "opinion"]
        .contains(&s["kind"].as_str().unwrap_or(""))
        || !["excerpt", "metadata"].contains(&s["storage"].as_str().unwrap_or(""))
    {
        return Err("Invalid source kind or storage policy".into());
    }
    Ok(())
}
fn validate_article_media(media: &Value) -> Result<()> {
    let items = media.as_array().ok_or("Invalid article media")?;
    if items.len() > 8 {
        return Err("Article has too many media items".into());
    }
    for item in items {
        crate::media::validate_media(item)?;
    }
    Ok(())
}
fn boolean(v: &Value) -> Result<bool> {
    v.as_bool().ok_or("Expected boolean".into())
}
fn minute(s: &str) -> Result<u32> {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' || ![b[0], b[1], b[3], b[4]].iter().all(u8::is_ascii_digit) {
        return Err("Quiet hours require HH:MM".into());
    }
    let h = s[..2].parse::<u32>().map_err(|_| "Invalid hour")?;
    let m = s[3..].parse::<u32>().map_err(|_| "Invalid minute")?;
    if h > 23 || m > 59 {
        return Err("Invalid quiet hours".into());
    }
    Ok(h * 60 + m)
}
pub fn quiet_now(q: &Value, local_minute: u32) -> Result<bool> {
    if q["enabled"] != true {
        return Ok(false);
    }
    let start = minute(text(q, "start", 5)?)?;
    let end = minute(text(q, "end", 5)?)?;
    Ok(if start == end {
        true
    } else if start < end {
        local_minute >= start && local_minute < end
    } else {
        local_minute >= start || local_minute < end
    })
}
fn validate_quiet(q: &Value) -> Result<()> {
    allowed_keys(q, &["enabled", "start", "end"])?;
    boolean(&q["enabled"])?;
    minute(text(q, "start", 5)?)?;
    minute(text(q, "end", 5)?)?;
    Ok(())
}
pub struct Database {
    conn: Connection,
    visited: HashSet<String>,
    // Ephemeral ABA guard; never exported. Conservative whole-cache invalidation.
    input_generation: u64,
    // Host-lifetime replacement identity: never persisted or accepted from backups.
    replacement_token: String,
}
fn preferences() -> Value {
    json!({"topics":[],"regions":[],"languages":["en"],"sources":[],"keywords":[],"excludeKeywords":[],"diversityCap":0.5})
}
fn profile(id: &str, name: &str) -> Value {
    json!({"id":id,"name":name,"preferences":preferences(),"quietHours":{"enabled":false,"start":"22:00","end":"08:00"},"alertsEnabled":false,"lastVisit":0,"previousVisit":0})
}
fn workspace() -> Value {
    json!({"tabs":[{"id":"home","title":"AI","topic":"","section":"ai","query":"","mode":"all"}],"activeTabId":"home","revision":0})
}
impl Database {
    pub(crate) fn input_generation(&self) -> u64 {
        self.input_generation
    }
    /// Reconcile catalog fields without resetting user preferences or fetch state.
    /// This runs within the caller's transaction; its revision table is not imported.
    fn migrate_catalog(&self, add_missing: bool) -> Result<()> {
        let mut source_count = self.list("source", "")?.len();
        for trusted in rights::catalog() {
            validate_source(trusted)?;
            let id = text(trusted, "id", 200)?;
            let old = self.get("source", id, "")?;
            let missing = old.is_none();
            if missing && (!add_missing || source_count >= MAX_SOURCES) {
                continue;
            }
            let mut next = old.clone().unwrap_or_else(|| trusted.clone());
            if next["url"] != trusted["url"] {
                next["aiAllowed"] = json!(false);
                next["mediaAllowed"] = json!(false);
                next.as_object_mut().unwrap().remove("rightsPolicy");
            } else {
                for (key, value) in trusted.as_object().unwrap() {
                    if matches!(key.as_str(), "enabled" | "status" | "lastSuccess") {
                        continue;
                    }
                    if key == "refreshMinutes" {
                        next[key] = json!(next[key]
                            .as_u64()
                            .unwrap_or(0)
                            .max(value.as_u64().unwrap_or(30)));
                    } else if (key == "storage" && next[key] == "metadata")
                        || (matches!(key.as_str(), "aiAllowed" | "mediaAllowed")
                            && old.as_ref().is_some_and(|o| {
                                o.get("rightsPolicy").is_some() && o[key] == false
                            }))
                    {
                        continue;
                    } else {
                        next[key] = value.clone();
                    }
                }
            }
            let revision = rights::policy_revision(&next);
            let prior: Option<String> = self
                .conn
                .query_row(
                    "SELECT revision FROM catalog_revisions WHERE source_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(sql)?;
            if prior.as_deref() != Some(&revision) {
                self.conn.execute("DELETE FROM rights_provenance WHERE article_id IN (SELECT id FROM articles WHERE source_id=?1)", [id]).map_err(sql)?;
                self.conn.execute("UPDATE articles SET data=json_set(data,'$.aiAllowed',json('false')) WHERE source_id=?1", [id]).map_err(sql)?;
                self.conn.execute("INSERT INTO catalog_revisions(source_id,revision) VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision", params![id,revision]).map_err(sql)?;
            }
            if next["storage"] == "metadata" {
                self.conn.execute("UPDATE articles SET data=json_set(data,'$.excerpt','','$.history',json('[]')) WHERE source_id=?1", [id]).map_err(sql)?;
            }
            if next["storage"] != "excerpt" || next["mediaAllowed"] != true {
                self.conn
                    .execute(
                        "UPDATE articles SET data=json_remove(data,'$.media') WHERE source_id=?1",
                        [id],
                    )
                    .map_err(sql)?;
            }
            self.put("source", id, "", &next)?;
            if missing {
                source_count += 1;
            }
        }
        Ok(())
    }
    pub fn ingest(&mut self, source_id: &str, feed: &Value, now: i64) -> Result<usize> {
        let mut source = self.get("source", source_id, "")?.ok_or("Unknown source")?;
        let items = feed["articles"].as_array().ok_or("Invalid feed articles")?;
        if items.len() > 1000 {
            return Err("Feed contains too many articles".into());
        }
        let mut pending = Vec::new();
        let mut proofs = Vec::new();
        let mut seen = HashSet::new();
        // Read the bounded comparison window once, not once for every feed entry.
        let mut stmt=self.conn.prepare("SELECT data FROM articles ORDER BY json_extract(data,'$.firstSeen') DESC,id LIMIT 1000").map_err(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(sql)?;
        let candidates = rows
            .map(|row| {
                serde_json::from_str::<Value>(&row.map_err(sql)?)
                    .map_err(|_| "Corrupt article".to_owned())
            })
            .collect::<Result<Vec<_>>>()?;
        for item in items {
            let url = canonical_url(text(item, "url", 4096)?)?;
            let title = text(item, "title", 2000)?;
            let excerpt = if source["storage"] == "metadata" {
                ""
            } else {
                item["excerpt"].as_str().unwrap_or("")
            };
            if excerpt.len() > 16000 {
                return Err("Feed excerpt is too large".into());
            }
            let aid = format!(
                "{:x}",
                Sha256::digest(format!("{source_id}:{url}").as_bytes())
            );
            if !seen.insert(aid.clone()) {
                continue;
            }
            let media = if source["mediaAllowed"] == true && source["storage"] == "excerpt" {
                if let Some(media) = item.get("media") {
                    validate_article_media(media)?;
                    Some(media.clone())
                } else {
                    None
                }
            } else {
                None
            };
            let old = self.article_raw(&aid)?;
            let proof = item
                .get("_rights")
                .filter(|p| {
                    p.to_string().len() <= 16384
                        && p["policy"] == rights::policy_revision(&source)
                        && p["input"] == rights::input_revision(item)
                })
                .cloned();
            let permitted = match rights::authority(&source, "aiAllowed") {
                Ok(Some(_)) => proof.as_ref().is_some_and(|p| p["ai"] == true),
                Ok(None) => self.custom_attested(&source, "aiAllowed")?,
                Err(_) => false,
            };
            proofs.push((aid.clone(), proof));
            let published = item["publishedAt"]
                .as_i64()
                .filter(|t| *t > 0 && *t <= now.saturating_add(86400));
            if old.as_ref().is_some_and(|a| {
                a["title"] == title
                    && a["excerpt"] == excerpt
                    && a["publishedAt"] == json!(published)
                    && a.get("media") == media.as_ref()
                    && a["aiAllowed"] == permitted
            }) {
                continue;
            }
            let mut history = old
                .as_ref()
                .and_then(|a| a["history"].as_array().cloned())
                .unwrap_or_default();
            if let Some(a) = &old {
                history
                    .push(json!({"at":a["updatedAt"],"title":a["title"],"excerpt":a["excerpt"]}));
            }
            if history.len() > 20 {
                history.drain(..history.len() - 20);
            }
            let mut article = json!({"id":aid,"sourceId":source_id,"sourceName":source["name"],"title":title,"url":url,"excerpt":excerpt,"publishedAt":published,"firstSeen":old.as_ref().map(|a|a["firstSeen"].clone()).unwrap_or(json!(now)),"updatedAt":now,"topics":source["topics"],"region":source["region"],"language":source["language"],"kind":source["kind"],"aiAllowed":permitted,"read":false,"saved":false,"hidden":false,"groupId":old.as_ref().map(|a|a["groupId"].clone()).unwrap_or(json!(aid)),"reasons":[],"score":0,"history":history});
            if let Some(media) = media {
                article["media"] = media;
            }
            crate::topics::apply(&source, &mut article);
            if old.is_none() {
                for candidate in &candidates {
                    if crate::intelligence::related(&article, candidate) {
                        article["groupId"] = candidate["groupId"].clone();
                        break;
                    }
                }
                for candidate in &pending {
                    if crate::intelligence::related(&article, candidate) {
                        article["groupId"] = candidate["groupId"].clone();
                        break;
                    }
                }
            }
            pending.push(article);
        }
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
        let result = (|| {
            for a in &pending {
                self.conn.execute("INSERT INTO articles(id,source_id,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![a["id"].as_str(),source_id,a.to_string()]).map_err(sql)?;
            }
            for (id, proof) in &proofs {
                self.conn
                    .execute("DELETE FROM rights_provenance WHERE article_id=?1", [id])
                    .map_err(sql)?;
                if let Some(proof) = proof {
                    self.conn
                        .execute(
                            "INSERT INTO rights_provenance(article_id,data) VALUES(?1,?2)",
                            params![id, proof.to_string()],
                        )
                        .map_err(sql)?;
                }
            }
            source["status"] = json!("Available");
            source["lastSuccess"] = json!(now);
            source["lastAttempt"] = json!(now);
            source["retryAt"] = json!(0);
            source["failures"] = json!(0);
            for key in ["etag", "lastModified"] {
                if let Some(v) = feed.get(key) {
                    if v.as_str().is_some_and(|s| s.len() < 4096) {
                        source[key] = v.clone();
                    }
                }
            }
            self.put("source", source_id, "", &source)?;
            self.put("meta", "lastRefresh", "", &json!(now))?;
            Ok(pending.len())
        })();
        self.conn
            .execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
            .map_err(sql)?;
        if result.as_ref().is_ok_and(|count| *count > 0) {
            self.input_generation = self.input_generation.saturating_add(1);
        }
        result
    }
    /// Host gate: call before each AI attempt, fallback, cache reuse and export.
    /// Article contents are compared with the exact current DB input revision.
    pub fn authorize_ai(&self, article: &Value) -> Result<()> {
        let (source, current) = self.current_rights_input(article)?;
        match rights::authority(&source, "aiAllowed")? {
            None if self.custom_attested(&source, "aiAllowed")? => Ok(()),
            None => {
                Err("Custom source permission must be explicitly confirmed after import".into())
            }
            Some(_) => {
                let proof = self.provenance(&source, &current)?;
                if proof["ai"] == true && current["aiAllowed"] == true {
                    Ok(())
                } else {
                    Err("Feed item is not eligible for AI under the reviewed policy".into())
                }
            }
        }
    }
    /// Returns a compiled byte-pinned asset approval, or None for an explicitly
    /// attested custom feed. Pass it to media::load_authorized_media; never return
    /// the approval object to a renderer as an authorization token.
    pub fn authorize_media(&self, article: &Value, item: &Value) -> Result<Option<Value>> {
        let (source, current) = self.current_rights_input(article)?;
        crate::media::validate_media(item)?;
        if !current["media"]
            .as_array()
            .is_some_and(|items| items.contains(item))
        {
            return Err("Media is not supplied by this stored article".into());
        }
        let Some(trusted) = rights::authority(&source, "mediaAllowed")? else {
            return if self.custom_attested(&source, "mediaAllowed")? {
                Ok(None)
            } else {
                Err("Confirm custom media permission after import".into())
            };
        };
        let proof = self.provenance(&source, &current)?;
        let approval = trusted["rightsPolicy"]["mediaAllowlist"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|a| {
                a["itemGuid"] == proof["guid"]
                    && a["itemUrl"] == proof["itemUrl"]
                    && a["itemUrl"] == current["url"]
                    && a["url"] == item["url"]
                    && a["kind"] == item["kind"]
                    && a["credit"] == item["credit"]
                    && proof["assets"]
                        .as_array()
                        .is_some_and(|urls| urls.contains(&item["url"]))
            })
            .ok_or("Media is outside the reviewed exact-asset policy")?;
        Ok(Some(approval.clone()))
    }

    fn current_rights_input(&self, article: &Value) -> Result<(Value, Value)> {
        let current = self
            .article_raw(text(article, "id", 200)?)?
            .ok_or("Unknown article")?;
        if article["sourceId"] != current["sourceId"]
            || rights::input_revision(article) != rights::input_revision(&current)
        {
            return Err("Article changed; reload before requesting rights-sensitive work".into());
        }
        let source = self
            .get("source", text(&current, "sourceId", 200)?, "")?
            .ok_or("Unknown source")?;
        Ok((source, current))
    }
    fn provenance(&self, source: &Value, article: &Value) -> Result<Value> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM rights_provenance WHERE article_id=?1",
                [article["id"].as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        let proof: Value = serde_json::from_str(
            &raw.ok_or("Refresh this item to establish trusted rights provenance")?,
        )
        .map_err(|_| "Invalid rights provenance")?;
        if proof["policy"] != rights::policy_revision(source)
            || proof["input"] != rights::input_revision(article)
        {
            return Err("Policy/input revision changed; refresh to revalidate rights".into());
        }
        Ok(proof)
    }
    fn custom_attested(&self, source: &Value, capability: &str) -> Result<bool> {
        let revision: Option<String> = self
            .conn
            .query_row(
                "SELECT revision FROM source_attestations WHERE source_id=?1",
                [source["id"].as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        let receipt: Value = revision
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or(Value::Null);
        Ok(receipt["revision"] == rights::policy_revision(source) && receipt[capability] == true)
    }
    fn record_attestation(&self, source: &Value, ai_attested: bool) -> Result<()> {
        self.conn.execute("INSERT INTO source_attestations(source_id,revision) VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision", params![source["id"].as_str(),json!({"revision":rights::policy_revision(source),"aiAllowed":ai_attested,"mediaAllowed":source["mediaAllowed"]}).to_string()]).map_err(sql)?;
        Ok(())
    }
    pub fn article_raw(&self, id: &str) -> Result<Option<Value>> {
        let data: Option<String> = self
            .conn
            .query_row("SELECT data FROM articles WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(sql)?;
        data.map(|s| serde_json::from_str(&s).map_err(|_| "Corrupt article".into()))
            .transpose()
    }
    fn articles(&self, profile_id: &str, query: Option<&str>) -> Result<Vec<Value>> {
        self.require_profile(profile_id)?;
        let (sql_text, arg) = if let Some(q) = query {
            if q.len() > 500 {
                return Err("Search is limited to 500 characters".into());
            }
            let tokens = q
                .split_whitespace()
                .take(30)
                .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
                .collect::<Vec<_>>();
            if tokens.is_empty() {
                return Ok(vec![]);
            }
            ("SELECT a.data,s.data FROM articles a LEFT JOIN states s ON s.article_id=a.id AND s.profile_id=?1 WHERE a.id IN (SELECT id FROM articles_fts WHERE articles_fts MATCH ?2) ORDER BY json_extract(a.data,'$.firstSeen') DESC,a.id LIMIT 5000",tokens.join(" AND "))
        } else {
            ("SELECT a.data,s.data FROM articles a LEFT JOIN states s ON s.article_id=a.id AND s.profile_id=?1 WHERE ?2='' AND (json_extract(s.data,'$.saved')=1 OR a.id IN (SELECT id FROM articles ORDER BY json_extract(data,'$.firstSeen') DESC,id LIMIT 5000)) ORDER BY json_extract(a.data,'$.firstSeen') DESC,a.id",String::new())
        };
        self.read_articles(sql_text, params![profile_id, arg])
    }
    fn day_articles(
        &self,
        profile_id: &str,
        day: &crate::briefing::DayBounds,
        now: i64,
    ) -> Result<Vec<Value>> {
        // Do not reuse the snapshot's newest-5,000 window for historical coverage.
        // Query the retained day directly; NULL publication time is a separate first-seen count.
        self.read_articles(
            "SELECT a.data,s.data FROM articles a LEFT JOIN states s ON s.article_id=a.id AND s.profile_id=?1 WHERE coalesce(json_extract(a.data,'$.publishedAt'),json_extract(a.data,'$.firstSeen'))>=?2 AND coalesce(json_extract(a.data,'$.publishedAt'),json_extract(a.data,'$.firstSeen'))<?3 AND coalesce(json_extract(a.data,'$.publishedAt'),json_extract(a.data,'$.firstSeen'))<=?4",
            params![profile_id, day.start, day.end, now],
        )
    }
    fn read_articles<P: rusqlite::Params>(&self, sql_text: &str, args: P) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare(sql_text).map_err(sql)?;
        let rows = stmt
            .query_map(args, |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(sql)?;
        let mut out = Vec::new();
        for row in rows {
            let (a, s) = row.map_err(sql)?;
            let mut a: Value = serde_json::from_str(&a).map_err(|_| "Corrupt article")?;
            if let Some(s) = s {
                let s: Value = serde_json::from_str(&s).map_err(|_| "Corrupt article state")?;
                for key in ["read", "saved", "hidden", "groupId"] {
                    if let Some(v) = s.get(key) {
                        a[key] = v.clone();
                    }
                }
            }
            out.push(a);
        }
        Ok(out)
    }
    pub fn article(&self, profile_id: &str, id: &str) -> Result<Value> {
        self.require_profile(profile_id)?;
        let mut a = self.article_raw(id)?.ok_or("Unknown article")?;
        let state = self.state(profile_id, id)?;
        for key in ["read", "saved", "hidden", "groupId"] {
            if let Some(v) = state.get(key) {
                a[key] = v.clone();
            }
        }
        Ok(a)
    }
    fn reclassify_all(&self) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,source_id,data FROM articles ORDER BY id")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(sql)?;
        let mut updates = Vec::new();
        for row in rows {
            let (id, source_id, raw) = row.map_err(sql)?;
            let mut article: Value =
                serde_json::from_str(&raw).map_err(|_| "Corrupt article".to_owned())?;
            let before = json!([
                article["classificationVersion"],
                article["sections"],
                article["topicLabels"],
                article["classificationReasons"]
            ]);
            let source = self
                .get("source", &source_id, "")?
                .ok_or("Unknown article source")?;
            crate::topics::apply(&source, &mut article);
            let after = json!([
                article["classificationVersion"],
                article["sections"],
                article["topicLabels"],
                article["classificationReasons"]
            ]);
            if before != after {
                updates.push((id, article.to_string()));
            }
        }
        drop(stmt);
        for (id, data) in &updates {
            self.conn
                .execute("UPDATE articles SET data=?1 WHERE id=?2", params![data, id])
                .map_err(sql)?;
        }
        Ok(updates.len())
    }
    fn state(&self, profile_id: &str, article_id: &str) -> Result<Value> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM states WHERE profile_id=?1 AND article_id=?2",
                params![profile_id, article_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        raw.map(|s| serde_json::from_str(&s).map_err(|_| "Corrupt state".into()))
            .unwrap_or(Ok(json!({"read":false,"saved":false,"hidden":false})))
    }

    /// Delivers claimed alerts through the OS sink (or a deterministic test sink).
    pub fn deliver_alerts<F>(&mut self, now: i64, local_minute: u32, mut send: F) -> Result<usize>
    where
        F: FnMut(&Value) -> Result<()>,
    {
        let mut failed = 0;
        for alert in self.alerts(now, local_minute)? {
            if send(&alert).is_err() {
                // A failed OS call is not a delivered notification. Keep the durable
                // attempt counter/backoff, but release its deduplication receipt.
                self.conn
                    .execute(
                        "DELETE FROM alert_log WHERE profile_id=?1 AND article_id=?2",
                        params![alert["profileId"].as_str(), alert["articleId"].as_str()],
                    )
                    .map_err(sql)?;
                failed += 1;
            }
        }
        Ok(failed)
    }
    pub fn alerts(&mut self, now: i64, local_minute: u32) -> Result<Vec<Value>> {
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
        let result = self.claim_alerts(now, local_minute);
        self.conn
            .execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
            .map_err(sql)?;
        result
    }
    fn claim_alerts(&mut self, now: i64, local_minute: u32) -> Result<Vec<Value>> {
        let mut alerts = Vec::new();
        for profile in self.list("profile", "")? {
            if profile["alertsEnabled"] != true || quiet_now(&profile["quietHours"], local_minute)?
            {
                continue;
            }
            let pid = text(&profile, "id", 200)?;
            let used: usize = self
                .conn
                .query_row(
                    "SELECT count(*) FROM alert_log WHERE profile_id=?1 AND at>?2",
                    params![pid, now - 600],
                    |r| r.get(0),
                )
                .map_err(sql)?;
            let attempts: usize = self.conn.query_row(
                "SELECT coalesce(sum(attempts),0) FROM alert_attempts WHERE profile_id=?1 AND at>?2",
                params![pid, now - 600], |r| r.get(0)).map_err(sql)?;
            // Three deliveries / ten minutes, at most nine OS attempts including retries.
            let mut budget = 3usize
                .saturating_sub(used)
                .min(9usize.saturating_sub(attempts));
            if budget == 0 {
                continue;
            }
            let rules = self.list("watchlist", pid)?;
            for article in self.articles(pid, None)? {
                let first = article["firstSeen"].as_i64().unwrap_or(0);
                if first < now - 300
                    || first > now
                    || article["hidden"] == true
                    || article["read"] == true
                {
                    continue;
                }
                if !rules
                    .iter()
                    .any(|w| w["alerts"] == true && crate::intelligence::matches(w, &article))
                {
                    continue;
                }
                let aid = text(&article, "id", 200)?;
                let attempt: Option<(usize, i64)> = self.conn.query_row(
                    "SELECT attempts,at FROM alert_attempts WHERE profile_id=?1 AND article_id=?2",
                    params![pid, aid], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(sql)?;
                if attempt.is_some_and(|(count, at)| count >= 3 || now < at.saturating_add(60)) {
                    continue;
                }
                let inserted=self.conn.execute("INSERT OR IGNORE INTO alert_log(profile_id,article_id,at) VALUES(?1,?2,?3)",params![pid,aid,now]).map_err(sql)?;
                if inserted > 0 {
                    self.conn.execute("INSERT INTO alert_attempts(profile_id,article_id,at,attempts) VALUES(?1,?2,?3,1) ON CONFLICT(profile_id,article_id) DO UPDATE SET at=excluded.at,attempts=alert_attempts.attempts+1",params![pid,aid,now]).map_err(sql)?;
                    alerts.push(json!({"profileId":pid,"profileName":profile["name"],"articleId":aid,"title":article["title"],"sourceName":article["sourceName"],"url":article["url"]}));
                    budget -= 1;
                    if budget == 0 {
                        break;
                    }
                }
            }
        }
        Ok(alerts)
    }
    pub fn retain(&mut self, now: i64) -> Result<usize> {
        self.conn
            .execute("DELETE FROM alert_attempts WHERE at<?1", [now - 600])
            .map_err(sql)?;
        let removed=self.conn.execute("DELETE FROM articles WHERE id NOT IN (SELECT article_id FROM states WHERE json_extract(data,'$.saved')=1) AND (json_extract(data,'$.firstSeen')<?1 OR id NOT IN (SELECT id FROM articles ORDER BY json_extract(data,'$.firstSeen') DESC,id LIMIT 5000))",[now-30*86400]).map_err(sql)?;
        self.conn
            .execute("DELETE FROM alert_log WHERE at<?1", [now - 90 * 86400])
            .map_err(sql)?;
        self.conn
            .execute_batch("PRAGMA incremental_vacuum(100)")
            .map_err(sql)?;
        if removed > 0 {
            self.input_generation = self.input_generation.saturating_add(1);
        }
        Ok(removed)
    }
    pub fn export(&self) -> Result<String> {
        let mut stmt = self
            .conn
            .prepare("SELECT kind,id,scope,data FROM documents ORDER BY kind,id,scope")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(sql)?;
        let mut docs = Vec::new();
        for row in rows {
            let (k, id, scope, s) = row.map_err(sql)?;
            let data: Value = serde_json::from_str(&s).map_err(|_| "Corrupt record")?;
            docs.push(json!({"kind":k,"id":id,"scope":scope,"data":data}));
        }
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM articles ORDER BY id")
            .map_err(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(sql)?;
        let mut articles = Vec::new();
        for row in rows {
            articles.push(
                serde_json::from_str::<Value>(&row.map_err(sql)?).map_err(|_| "Corrupt article")?,
            );
        }
        let mut stmt = self
            .conn
            .prepare("SELECT profile_id,article_id,data FROM states ORDER BY profile_id,article_id")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(sql)?;
        let mut states = Vec::new();
        for row in rows {
            let (p, a, s) = row.map_err(sql)?;
            states.push(json!({"profileId":p,"articleId":a,"data":serde_json::from_str::<Value>(&s).map_err(|_|"Corrupt state")?}));
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT profile_id,article_id,at FROM alert_log ORDER BY profile_id,article_id",
            )
            .map_err(sql)?;
        let rows=stmt.query_map([],|r|Ok(json!({"profileId":r.get::<_,String>(0)?,"articleId":r.get::<_,String>(1)?,"at":r.get::<_,i64>(2)?}))).map_err(sql)?;
        let alerts = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql)?;
        let data=json!({"version":1,"documents":docs,"articles":articles,"states":states,"alerts":alerts}).to_string();
        // Never report a successful backup that this version cannot restore.
        validate_backup(&data).map_err(|e| format!("Cannot export restorable backup: {e}"))?;
        Ok(data)
    }
    pub fn import(&mut self, data: &str) -> Result<()> {
        let backup = validate_backup(data)?;
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
        let result = (|| {
            self.conn.execute_batch("DELETE FROM states; DELETE FROM articles; DELETE FROM documents; DELETE FROM alert_log; DELETE FROM alert_attempts; DELETE FROM rights_provenance; DELETE FROM source_attestations; DELETE FROM media_preferences;").map_err(sql)?;
            for d in backup["documents"].as_array().unwrap() {
                let mut v = d["data"].clone();
                if d["kind"] == "provider" {
                    v["enabled"] = json!(false);
                    v["consented"] = json!(false);
                }
                self.put(
                    d["kind"].as_str().unwrap(),
                    d["id"].as_str().unwrap(),
                    d["scope"].as_str().unwrap(),
                    &v,
                )?;
            }
            self.migrate_catalog(false)?;
            for original in backup["articles"].as_array().unwrap() {
                let mut a = original.clone();
                a["aiAllowed"] = json!(false);
                let source = self
                    .get("source", a["sourceId"].as_str().unwrap(), "")?
                    .ok_or("Unknown restored source")?;
                if source["storage"] == "metadata" {
                    a["excerpt"] = json!("");
                    a["history"] = json!([]);
                }
                if source["storage"] != "excerpt" || source["mediaAllowed"] != true {
                    a.as_object_mut().unwrap().remove("media");
                }
                self.conn
                    .execute(
                        "INSERT INTO articles(id,source_id,data) VALUES(?1,?2,?3)",
                        params![a["id"].as_str(), a["sourceId"].as_str(), a.to_string()],
                    )
                    .map_err(sql)?;
            }
            self.reclassify_all()?;
            for s in backup["states"].as_array().unwrap() {
                self.conn
                    .execute(
                        "INSERT INTO states(profile_id,article_id,data) VALUES(?1,?2,?3)",
                        params![
                            s["profileId"].as_str(),
                            s["articleId"].as_str(),
                            s["data"].to_string()
                        ],
                    )
                    .map_err(sql)?;
            }
            for a in backup["alerts"].as_array().unwrap() {
                self.conn
                    .execute(
                        "INSERT INTO alert_log(profile_id,article_id,at) VALUES(?1,?2,?3)",
                        params![
                            a["profileId"].as_str(),
                            a["articleId"].as_str(),
                            a["at"].as_i64()
                        ],
                    )
                    .map_err(sql)?;
            }
            Ok(())
        })();
        self.conn
            .execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
            .map_err(sql)?;
        if result.is_ok() {
            self.input_generation = self.input_generation.saturating_add(1);
            self.replacement_token = uuid::Uuid::new_v4().to_string();
            self.visited.clear();
        }
        result
    }
    pub fn due_sources(&self, now: i64, _manual: bool) -> Result<Vec<Value>> {
        Ok(self
            .list("source", "")?
            .into_iter()
            .filter(|s| {
                let interval = s["refreshMinutes"].as_i64().unwrap_or(30).clamp(5, 1440) * 60;
                s["enabled"] == true
                    && s["retryAt"].as_i64().unwrap_or(0) <= now
                    && s["lastAttempt"]
                        .as_i64()
                        .is_none_or(|last| now.saturating_sub(last) >= interval)
            })
            .collect())
    }
    pub fn source_failed(&self, id: &str, error: &str, now: i64) -> Result<()> {
        let mut s = self.get("source", id, "")?.ok_or("Unknown source")?;
        let failures = s["failures"]
            .as_u64()
            .unwrap_or(0)
            .saturating_add(1)
            .min(12);
        let retry = error
            .split("retry after ")
            .nth(1)
            .and_then(|v| v.split_whitespace().next())
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or((60_i64 * 2_i64.pow(failures as u32)).min(3600))
            .clamp(1, 86400);
        s["status"] = json!(error.chars().take(300).collect::<String>());
        s["lastAttempt"] = json!(now);
        s["retryAt"] = json!(now + retry);
        s["failures"] = json!(failures);
        self.put("source", id, "", &s)
    }
    pub fn memory() -> Result<Self> {
        Self::initialize(Connection::open_in_memory().map_err(sql)?)
    }
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path).map_err(sql)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(sql)?;
        if version > 1 {
            return Err("Database is from a newer application; update News Terminal.".into());
        }
        if version < 1 && path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let backup = path.with_extension("pre-migration.sqlite3");
            if !backup.exists() {
                conn.backup("main", &backup, None).map_err(sql)?;
            }
        }
        let db = Self::initialize(conn)?;
        db.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
        let result = db
            .migrate_catalog(true)
            .and_then(|_| db.reclassify_all().map(|_| ()));
        db.conn
            .execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
            .map_err(sql)?;
        result?;
        Ok(db)
    }
    fn initialize(conn: Connection) -> Result<Self> {
        conn.busy_timeout(Duration::from_secs(5)).map_err(sql)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;")
            .map_err(sql)?;
        if let Err(e) = conn.execute_batch(include_str!("../migrations/001_initial.sql")) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(sql(e));
        }
        // Additive retry bookkeeping; receipts retain the v1 backup/schema contract.
        if let Err(e) = conn.execute_batch("CREATE TABLE IF NOT EXISTS alert_attempts(profile_id TEXT NOT NULL,article_id TEXT NOT NULL,at INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(profile_id,article_id));") {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(sql(e));
        }
        conn.execute_batch("CREATE TABLE IF NOT EXISTS rights_provenance(article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS source_attestations(source_id TEXT PRIMARY KEY,revision TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS catalog_revisions(source_id TEXT PRIMARY KEY,revision TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS media_preferences(profile_id TEXT PRIMARY KEY,automatic INTEGER NOT NULL,mode TEXT NOT NULL);").map_err(sql)?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS metadata_cache(source TEXT PRIMARY KEY,data TEXT NOT NULL);").map_err(sql)?;
        conn.execute_batch("COMMIT").map_err(sql)?;
        let db = Self {
            conn,
            visited: HashSet::new(),
            input_generation: 0,
            replacement_token: uuid::Uuid::new_v4().to_string(),
        };
        if db.get("profile", "default", "")?.is_none() {
            db.put("profile", "default", "", &profile("default", "Global"))?;
            db.put("workspace", "default", "", &workspace())?;
        }
        for (id, name, model) in [
            ("ollama", "Ollama", "llama3.2"),
            ("gemini", "Gemini", "gemini-2.5-flash"),
            ("groq", "Groq", "llama-3.3-70b-versatile"),
        ] {
            if db.get("provider", id, "")?.is_none() {
                db.put("provider",id,"",&json!({"id":id,"name":name,"kind":id,"model":model,"enabled":false,"consented":false}))?;
            }
        }
        Ok(db)
    }
    // Public metadata is kept outside documents/backups and never imports rights.
    pub fn metadata_cache_get(&self, source: &str) -> Result<Option<Value>> {
        if !["openrouter", "huggingface", "arena", "swebench"].contains(&source) {
            return Err("Unknown metadata source".into());
        }
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM metadata_cache WHERE source=?1",
                [source],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?;
        raw.map(|s| serde_json::from_str(&s).map_err(|_| "Invalid metadata cache".into()))
            .transpose()
    }
    pub fn metadata_cache_put(&self, source: &str, value: &Value) -> Result<()> {
        if !["openrouter", "huggingface", "arena", "swebench"].contains(&source)
            || value["complete"] != true
        {
            return Err("Invalid metadata cache snapshot".into());
        }
        let raw = value.to_string();
        if raw.len() > 8 * 1024 * 1024 {
            return Err("Metadata cache exceeds bound".into());
        }
        self.conn.execute("INSERT INTO metadata_cache(source,data) VALUES(?1,?2) ON CONFLICT(source) DO UPDATE SET data=excluded.data",params![source,raw]).map_err(sql)?;
        Ok(())
    }
    fn put(&self, kind: &str, id: &str, scope: &str, data: &Value) -> Result<()> {
        self.conn.execute("INSERT INTO documents(kind,id,scope,data) VALUES(?1,?2,?3,?4) ON CONFLICT(kind,id,scope) DO UPDATE SET data=excluded.data",params![kind,id,scope,data.to_string()]).map_err(sql)?;
        Ok(())
    }
    fn get(&self, kind: &str, id: &str, scope: &str) -> Result<Option<Value>> {
        let s: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM documents WHERE kind=?1 AND id=?2 AND scope=?3",
                params![kind, id, scope],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        s.map(|s| serde_json::from_str(&s).map_err(|_| "Corrupt local record".into()))
            .transpose()
    }
    pub fn list(&self, kind: &str, scope: &str) -> Result<Vec<Value>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM documents WHERE kind=?1 AND scope=?2 ORDER BY id")
            .map_err(sql)?;
        let rows = stmt
            .query_map(params![kind, scope], |r| r.get::<_, String>(0))
            .map_err(sql)?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(sql)?).map_err(|_| "Corrupt local record".into())
        })
        .collect()
    }
    /// Lightweight native ownership check: never loads or ranks cached articles.
    pub fn workspace_owner_exists(&self, profile_id: &str, tab_id: Option<&str>) -> Result<bool> {
        if self.get("profile", profile_id, "")?.is_none() {
            return Ok(false);
        }
        match tab_id {
            None => Ok(true),
            Some(tab_id) => Ok(self.get("workspace", profile_id, "")?.is_some_and(|w| {
                w["tabs"]
                    .as_array()
                    .is_some_and(|tabs| tabs.iter().any(|t| t["id"] == tab_id))
            })),
        }
    }
    fn require_profile(&self, id: &str) -> Result<Value> {
        self.get("profile", id, "")?.ok_or("Unknown profile".into())
    }
    pub fn media_preferences(&self, id: &str) -> Result<Value> {
        self.require_profile(id)?;
        let pref = self
            .conn
            .query_row(
                "SELECT automatic,mode FROM media_preferences WHERE profile_id=?1",
                [id],
                |r| Ok((r.get::<_, bool>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(sql)?;
        let (automatic, mode) = pref.unwrap_or((false, "visual".into()));
        Ok(json!({"automatic":automatic,"mode":mode,"replacementToken":self.replacement_token}))
    }
    pub fn authorize_media_request(&self, r: &Value) -> Result<()> {
        self.require_replacement(r)?;
        let id = text(r, "profileId", 200)?;
        let prefs = self.media_preferences(id)?;
        if r["automatic"] == true && (prefs["automatic"] != true || prefs["mode"] != "visual") {
            return Err("Automatic images need this profile's consent and Visual mode".into());
        }
        Ok(())
    }
    fn require_replacement(&self, r: &Value) -> Result<()> {
        if r["replacementToken"].as_str() != Some(self.replacement_token.as_str()) {
            return Err("Database replaced: reload before making a new change".into());
        }
        Ok(())
    }
    pub fn request(&mut self, r: &Value, now: i64) -> Result<Value> {
        let id = if r.get("profileId").is_some() {
            text(r, "profileId", 200)?
        } else {
            "default"
        };
        match r["op"].as_str().unwrap_or("") {
            "media_preferences" => self.media_preferences(id),
            "media_preferences_set" => {
                self.require_replacement(r)?;
                self.require_profile(id)?;
                let automatic = r["automatic"].as_bool().ok_or("Invalid image consent")?;
                let mode = r["mode"]
                    .as_str()
                    .filter(|s| matches!(*s, "visual" | "compact"))
                    .ok_or("Invalid image mode")?;
                self.conn.execute("INSERT INTO media_preferences(profile_id,automatic,mode) VALUES(?1,?2,?3) ON CONFLICT(profile_id) DO UPDATE SET automatic=excluded.automatic,mode=excluded.mode", params![id, automatic, mode]).map_err(sql)?;
                self.media_preferences(id)
            }
            "snapshot" => Ok(
                json!({"replacementToken":self.replacement_token,"profiles":self.list("profile","")?,"profile":self.require_profile(id)?,"sources":self.list("source","")?,"articles":crate::intelligence::rank(self.articles(id,None)?,&self.require_profile(id)?["preferences"],now),"watchlists":self.list("watchlist",id)?,"workspace":self.get("workspace",id,"")?.unwrap_or_else(workspace),"providers":self.list("provider","")?,"lastRefresh":self.get("meta","lastRefresh","")?}),
            ),
            "workspace_get" => {
                let id = text(r, "profileId", 200)?;
                self.require_profile(id)?;
                let mut result = self.get("workspace", id, "")?.unwrap_or_else(workspace);
                result["replacementToken"] = json!(self.replacement_token);
                Ok(result)
            }
            "hidden_stories" => {
                let id = text(r, "profileId", 200)?;
                self.require_profile(id)?;
                Ok(json!(self.read_articles(
                    "SELECT a.data,s.data FROM states s JOIN articles a ON a.id=s.article_id WHERE s.profile_id=?1 AND json_extract(s.data,'$.hidden')=1 ORDER BY json_extract(a.data,'$.firstSeen') DESC,a.id ASC",
                    [id],
                )?))
            }
            "daily_brief" => {
                let profile = self.require_profile(id)?;
                let date = r
                    .get("date")
                    .map(|v| v.as_str().ok_or("Date must be YYYY-MM-DD"))
                    .transpose()?;
                let day = crate::briefing::local_day(date, now)?;
                Ok(crate::briefing::build(
                    &self.day_articles(id, &day, now)?,
                    &profile["preferences"],
                    &day,
                    now,
                ))
            }
            "provider_save" => {
                let p = &r["provider"];
                validate_provider(p)?;
                let safe = json!({"id":p["id"],"kind":p["kind"],"name":p["name"],"model":p["model"],"enabled":p["enabled"],"consented":p["consented"]});
                self.put("provider", p["id"].as_str().unwrap(), "", &safe)?;
                Ok(Value::Null)
            }
            "export" => Ok(json!(self.export()?)),
            "import" => {
                self.import(r["data"].as_str().ok_or("Invalid backup data")?)?;
                Ok(Value::Null)
            }
            "workspace_save" => {
                self.require_replacement(r)?;
                self.require_profile(id)?;
                let mut w = r["workspace"].clone();
                if let Some(object) = w.as_object_mut() {
                    object.remove("replacementToken");
                }
                validate_workspace(&w)?;
                let current = self.get("workspace", id, "")?.unwrap_or_else(workspace);
                let revision = current["revision"].as_u64().unwrap_or(0);
                let expected = r
                    .get("expectedRevision")
                    .or_else(|| w.get("revision"))
                    .ok_or("Workspace revision is required; reload and retry")?;
                if expected.as_u64() != Some(revision) {
                    return Err(
                        "Workspace conflict: another window changed these tabs. Reload and retry."
                            .into(),
                    );
                }
                let next = revision
                    .checked_add(1)
                    .filter(|r| *r <= MAX_WORKSPACE_REVISION)
                    .ok_or("Workspace revision limit reached; cannot save safely")?;
                w["revision"] = json!(next);
                self.put("workspace", id, "", &w)?;
                Ok(Value::Null)
            }
            "watchlist_save" => {
                self.require_profile(id)?;
                let w = &r["watchlist"];
                validate_watchlist(w)?;
                let wid = w["id"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                if wid.len() > 200 || wid.is_empty() {
                    return Err("Invalid watchlist id".into());
                }
                if self.get("watchlist", &wid, id)?.is_none()
                    && self.list("watchlist", id)?.len() >= 100
                {
                    return Err("Maximum 100 watchlists per profile".into());
                }
                let value = json!({"id":wid,"name":w["name"],"keywords":w["keywords"],"topics":w["topics"],"sources":w["sources"],"alerts":w["alerts"]});
                self.put("watchlist", &wid, id, &value)?;
                Ok(value)
            }
            "watchlist_delete" => {
                self.require_profile(id)?;
                self.conn
                    .execute(
                        "DELETE FROM documents WHERE kind='watchlist' AND id=?1 AND scope=?2",
                        params![text(r, "id", 200)?, id],
                    )
                    .map_err(sql)?;
                Ok(Value::Null)
            }
            "source_add" => {
                if self.list("source", "")?.len() >= MAX_SOURCES {
                    return Err(format!("Maximum {MAX_SOURCES} sources"));
                }
                let mut s = json!({"id":uuid::Uuid::new_v4().to_string(),"name":text(r,"name",100)?,"url":canonical_url(text(r,"url",4096)?)?,"homepage":canonical_url(text(r,"url",4096)?)?,"topics":r["topics"],"region":text(r,"region",100)?,"language":text(r,"language",40)?,"kind":text(r,"kind",30)?,"termsUrl":canonical_url(text(r,"termsUrl",4096)?)?,"storage":text(r,"storage",20)?,"enabled":true,"status":"Not refreshed","lastSuccess":null,"aiAllowed":false,"mediaAllowed":false,"refreshMinutes":30,"accessMode":"approval-free","sourceAdapter":"feed","publisher":text(r,"name",100)?,"imagesAvailable":false});
                validate_source(&s)?;
                if let Some(v) = r.get("aiAllowed") {
                    boolean(v)?;
                    s["aiAllowed"] = v.clone();
                }
                s["mediaAllowed"] = json!(r
                    .get("mediaAllowed")
                    .map(boolean)
                    .transpose()?
                    .unwrap_or(false));
                self.put("source", s["id"].as_str().unwrap(), "", &s)?;
                self.record_attestation(&s, s["aiAllowed"] == true)?;
                Ok(s)
            }
            "source_update" => {
                let sid = text(r, "sourceId", 200)?;
                let mut s = self.get("source", sid, "")?.ok_or("Unknown source")?;
                let ai_attested = self.custom_attested(&s, "aiAllowed")?;
                if let Some(enabled) = r.get("enabled") {
                    s["enabled"] = json!(boolean(enabled)?);
                } else if r.get("mediaAllowed").is_none() {
                    return Err("Source update requires enabled or mediaAllowed".into());
                }
                if let Some(permission) = r.get("mediaAllowed") {
                    let permission = boolean(permission)?;
                    let catalog: Vec<Value> =
                        serde_json::from_str(include_str!("../../resources/sources.json"))
                            .map_err(|_| "Bundled source catalog is invalid")?;
                    if permission && catalog.iter().any(|source| source["id"] == sid) {
                        return Err("Catalog media rights require a reviewed catalog update, not a user override".into());
                    }
                    // For a custom feed, an explicit true is the user's media-rights attestation.
                    // It never implies permission to send publisher material to an AI provider.
                    s["mediaAllowed"] = json!(permission);
                }
                self.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
                let result = (|| {
                    self.put("source", sid, "", &s)?;
                    if rights::bundled(sid).is_none() && r.get("mediaAllowed").is_some() {
                        self.record_attestation(&s, ai_attested)?;
                    }
                    if s["enabled"] != true || s["mediaAllowed"] != true {
                        self.conn.execute("DELETE FROM rights_provenance WHERE article_id IN (SELECT id FROM articles WHERE source_id=?1)", [sid]).map_err(sql)?;
                    }
                    if s["mediaAllowed"] != true || s["storage"] != "excerpt" {
                        self.conn.execute("UPDATE articles SET data=json_remove(data,'$.media') WHERE source_id=?1 AND json_type(data,'$.media') IS NOT NULL", [sid]).map_err(sql)?;
                    }
                    Ok(Value::Null)
                })();
                self.conn
                    .execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
                    .map_err(sql)?;
                result
            }
            "article_state" | "group_split" => {
                self.require_replacement(r)?;
                self.require_profile(id)?;
                let aid = text(r, "articleId", 200)?;
                self.article_raw(aid)?.ok_or("Unknown article")?;
                let mut s = self.state(id, aid)?;
                if r["saved"] == true && s["saved"] != true {
                    let count:usize=self.conn.query_row("SELECT count(DISTINCT article_id) FROM states WHERE json_extract(data,'$.saved')=1",[],|row|row.get(0)).map_err(sql)?;
                    if count >= 10000 {
                        return Err(
                            "Maximum 10,000 saved stories; export and remove older saves first"
                                .into(),
                        );
                    }
                }
                for key in ["read", "saved", "hidden"] {
                    if let Some(v) = r.get(key) {
                        boolean(v)?;
                        s[key] = v.clone();
                    }
                }
                if r["op"] == "group_split" {
                    s["groupId"] = json!(format!("split:{id}:{aid}"));
                }
                self.conn.execute("INSERT INTO states(profile_id,article_id,data) VALUES(?1,?2,?3) ON CONFLICT(profile_id,article_id) DO UPDATE SET data=excluded.data",params![id,aid,s.to_string()]).map_err(sql)?;
                Ok(Value::Null)
            }
            "search" => Ok(json!(
                self.articles(id, Some(r["query"].as_str().ok_or("Invalid query")?))?
            )),
            "profile_create" => {
                if self.list("profile", "")?.len() >= 32 {
                    return Err("Maximum 32 profiles".into());
                }
                let name = text(r, "name", 80)?;
                let id = uuid::Uuid::new_v4().to_string();
                let p = profile(&id, name);
                self.put("profile", &id, "", &p)?;
                self.put("workspace", &id, "", &workspace())?;
                Ok(p)
            }
            "profile_update" | "profile_reset" | "visit" => {
                let mut p = self.require_profile(id)?;
                match r["op"].as_str().unwrap_or("") {
                    "profile_reset" => {
                        p["preferences"] = preferences();
                    }
                    "visit" => {
                        if self.visited.insert(id.to_owned()) {
                            p["previousVisit"] = p["lastVisit"].clone();
                            p["lastVisit"] = json!(now);
                        }
                    }
                    _ => {
                        if let Some(v) = r.get("preferences") {
                            let o = v.as_object().ok_or("Invalid preferences")?;
                            for (k, v) in o {
                                if k == "diversityCap" {
                                    let cap = v.as_f64().ok_or("Invalid diversity cap")?;
                                    if !(0.1..=1.0).contains(&cap) {
                                        return Err("Diversity cap must be 0.1 to 1".into());
                                    }
                                } else if [
                                    "topics",
                                    "regions",
                                    "languages",
                                    "sources",
                                    "keywords",
                                    "excludeKeywords",
                                ]
                                .contains(&k.as_str())
                                {
                                    strings(v, 100, 100)?;
                                } else {
                                    return Err("Unknown preference".into());
                                }
                                p["preferences"][k] = v.clone();
                            }
                        }
                        if let Some(q) = r.get("quietHours") {
                            validate_quiet(q)?;
                            p["quietHours"] = q.clone();
                        }
                        if let Some(v) = r.get("alertsEnabled") {
                            boolean(v)?;
                            p["alertsEnabled"] = v.clone();
                        }
                    }
                }
                self.put("profile", id, "", &p)?;
                Ok(p)
            }
            _ => Err("Unknown operation".into()),
        }
    }
}
