use super::*;
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
pub(super) fn validate_backup(raw: &str) -> Result<Value> {
    if raw.len() > 32 * 1024 * 1024 {
        return Err("Backup exceeds 32 MiB".into());
    }
    let b: Value = serde_json::from_str(raw).map_err(|_| "Invalid backup JSON")?;
    keys(
        &b,
        &["version", "documents", "articles", "states", "alerts"],
    )?;
    if b["version"] != 1 {
        return Err("Unsupported backup version".into());
    }
    let docs = bounded_array(&b, "documents", 5000)?;
    let articles = bounded_array(&b, "articles", 15000)?;
    let states = bounded_array(&b, "states", 50000)?;
    let alerts = bounded_array(&b, "alerts", 10000)?;
    let mut profiles = HashSet::new();
    let mut sources = HashSet::new();
    let mut providers = HashSet::new();
    let mut workspaces = HashSet::new();
    let mut identities = HashSet::new();
    let mut watch_counts = std::collections::HashMap::new();
    for d in docs {
        keys(d, &["kind", "id", "scope", "data"])?;
        let kind = text(d, "kind", 30)?;
        let id = text(d, "id", 200)?;
        safe_text(d, "scope", 200)?;
        let scope = d["scope"].as_str().unwrap();
        if !identities.insert((kind, id, scope)) {
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
                profiles.insert(id);
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
                sources.insert(id);
            }
            "provider" => {
                keys(v, &["id", "name", "kind", "model", "enabled", "consented"])?;
                validate_provider(v)?;
                if v["id"] != id {
                    return Err("Provider identity mismatch".into());
                }
                providers.insert(id);
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
                workspaces.insert(id);
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
                *watch_counts.entry(scope).or_insert(0) += 1;
            }
            "meta" if id == "lastRefresh" => {
                timestamp(v)?;
            }
            _ => return Err("Unknown backup record type".into()),
        }
    }
    if !profiles.contains("default")
        || profiles.len() > 32
        || sources.len() > MAX_SOURCES
        || providers != HashSet::from(["ollama", "gemini", "groq"])
        || workspaces != profiles
    {
        return Err("Backup missing required records or exceeds limits".into());
    }
    if watch_counts
        .iter()
        .any(|(p, n)| !profiles.contains(p) || *n > 100)
    {
        return Err("Invalid watchlist profile or count".into());
    }
    let mut article_ids = HashSet::new();
    for a in articles {
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
        let id = text(a, "id", 200)?;
        if !article_ids.insert(id) {
            return Err("Duplicate article".into());
        }
        if !sources.contains(text(a, "sourceId", 200)?) {
            return Err("Unknown article source".into());
        }
        let source = docs
            .iter()
            .find(|d| d["kind"] == "source" && d["id"] == a["sourceId"])
            .ok_or("Missing article source")?;
        if source["data"]["storage"] == "metadata"
            && (a["excerpt"] != ""
                || a["history"]
                    .as_array()
                    .is_some_and(|h| h.iter().any(|h| h["excerpt"] != "")))
        {
            return Err("Backup violates metadata-only storage policy".into());
        }
        if a["aiAllowed"] == true && source["data"]["aiAllowed"] != true {
            return Err("Backup violates source AI policy".into());
        }
        if let Some(media) = a.get("media") {
            validate_article_media(media)?;
            if !media.as_array().unwrap().is_empty()
                && (source["data"]["mediaAllowed"] != true
                    || source["data"]["storage"] != "excerpt")
            {
                return Err("Backup violates source media storage permission".into());
            }
        }
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
    }
    let mut seen = HashSet::new();
    for s in states {
        keys(s, &["profileId", "articleId", "data"])?;
        let p = text(s, "profileId", 200)?;
        let a = text(s, "articleId", 200)?;
        if !profiles.contains(p) || !article_ids.contains(a) || !seen.insert((p, a)) {
            return Err("Invalid state reference".into());
        }
        keys(&s["data"], &["read", "saved", "hidden", "groupId"])?;
        for k in ["read", "saved", "hidden"] {
            boolean(&s["data"][k])?;
        }
        if let Some(g) = s["data"].get("groupId") {
            if g.as_str().is_none_or(|s| s.len() > 500) {
                return Err("Invalid split group".into());
            }
        }
    }
    let mut seen = HashSet::new();
    for a in alerts {
        keys(a, &["profileId", "articleId", "at"])?;
        let p = text(a, "profileId", 200)?;
        let id = text(a, "articleId", 200)?;
        if !profiles.contains(p) || !seen.insert((p, id)) {
            return Err("Invalid alert record".into());
        }
        timestamp(&a["at"])?;
    }
    Ok(b)
}
