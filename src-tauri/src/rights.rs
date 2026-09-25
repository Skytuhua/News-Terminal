//! Reviewed source capabilities. JSON carried by an import is never authority.
use serde_json::Value;
#[cfg(test)]
#[path = "../tests/rights/fed_diagram.rs"]
mod fed_diagram_tests;
#[cfg(test)]
#[path = "../tests/rights/rights_classifier.rs"]
mod tests;

use serde_json::json;
use sha2::{Digest, Sha256};

pub fn catalog() -> &'static [Value] {
    static CATALOG: std::sync::OnceLock<Vec<Value>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/sources.json"))
            .expect("validated compiled catalog")
    })
}
fn custom_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
        && id.as_bytes()[14] == b'4'
        && b"89ab".contains(&id.as_bytes()[19])
}
pub fn bundled(id: &str) -> Option<&'static Value> {
    catalog().iter().find(|s| s["id"] == id)
}
/// Known identifiers never fall back to custom-source permission.
pub fn authority(source: &Value, capability: &str) -> Result<Option<&'static Value>, String> {
    if source["enabled"] != true || source[capability] != true || source["storage"] != "excerpt" {
        return Err("Source permission is disabled".into());
    }
    let id = source["id"].as_str().ok_or("Missing source id")?;
    match bundled(id) {
        Some(trusted) => {
            if source["url"] != trusted["url"]
                || trusted[capability] != true
                || source["rightsPolicy"] != trusted["rightsPolicy"]
            {
                return Err("Source does not match the reviewed catalog policy".into());
            }
            validate_policy(&trusted["rightsPolicy"])?;
            Ok(Some(trusted))
        }
        None if custom_id(id) && source.get("rightsPolicy").is_none() => Ok(None),
        None => Err("Unreviewed source identity".into()),
    }
}
pub fn digest(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}
pub fn policy_revision(source: &Value) -> String {
    digest(&json!([
        source["id"],
        source["url"],
        source["storage"],
        source["aiAllowed"],
        source["mediaAllowed"],
        source["rightsPolicy"]
    ]))
}
pub fn input_revision(article: &Value) -> String {
    digest(&json!([
        article["title"],
        article["url"],
        article["excerpt"],
        article["publishedAt"],
        article["media"]
    ]))
}
fn excluded(raw: &str) -> bool {
    let decoded = html_escape::decode_html_entities(raw);
    let raw = html_escape::decode_html_entities(&decoded).to_lowercase();
    let raw = format!(
        "{} {}",
        raw.split_whitespace().collect::<Vec<_>>().join(" "),
        normalized(&raw)
    );
    [
        "copyright",
        "©",
        "all rights reserved",
        "used with permission",
        "courtesy of",
        "third-party",
        "third party",
        "reuters",
        "associated press",
        "licensed",
        "rights reserved",
        "credit:",
        "credits:",
        "photo by",
        "image by",
        "provided by",
    ]
    .iter()
    .any(|s| raw.contains(s))
}
fn normalized(raw: &str) -> String {
    crate::services::plain_text(raw, usize::MAX)
}
fn exact_origin(raw: &str, host: &str) -> Option<url::Url> {
    let u = crate::services::public_url(raw).ok()?;
    (u.host_str() == Some(host) && u.fragment().is_none()).then_some(u)
}
fn issue_time(description: &str) -> bool {
    // A real issue line, not a timestamp merely mentioned inside arbitrary prose.
    let mut raw = html_escape::decode_html_entities(description).into_owned();
    for br in ["<br>", "<br/>", "<br />", "<BR>", "<BR/>", "<BR />"] {
        raw = raw.replace(br, "\n");
    }
    raw.lines().any(|line| {
        let line = normalized(line);
        let line = line.strip_prefix("Issued at ").unwrap_or(&line);
        let w: Vec<_> = line.split_whitespace().collect();
        if w.len() == 6 {
            return w[0].len() == 4
                && w[0].bytes().all(|b| b.is_ascii_digit())
                && w[0]
                    .parse::<u32>()
                    .is_ok_and(|n| n / 100 < 24 && n % 100 < 60)
                && w[1] == "UTC"
                && chrono::NaiveDate::parse_from_str(&w[2..6].join(" "), "%a %b %d %Y").is_ok();
        }
        if w.len() != 7 {
            return false;
        }
        let time = w[0];
        (3..=4).contains(&time.len())
            && time.bytes().all(|b| b.is_ascii_digit())
            && time
                .parse::<u32>()
                .is_ok_and(|n| n / 100 >= 1 && n / 100 <= 12 && n % 100 < 60)
            && matches!(w[1], "AM" | "PM")
            && matches!(w[2], "AST" | "EDT" | "EST" | "CDT" | "CST" | "UTC" | "GMT")
            && chrono::NaiveDate::parse_from_str(&w[3..7].join(" "), "%a %b %d %Y").is_ok()
    })
}
fn nhc(title: &str, description: &str, raw_url: &str) -> bool {
    let Some(u) = exact_origin(raw_url, "www.nhc.noaa.gov") else {
        return false;
    };
    if !normalized(description)
        .to_ascii_lowercase()
        .contains("nws national hurricane center")
        || !issue_time(description)
    {
        return false;
    }
    let title = normalized(title).to_ascii_lowercase();
    if ["graphics", "wind speed probabilities", "summary for"]
        .iter()
        .any(|term| title.contains(term))
    {
        return false;
    }
    if u.path() == "/gtwo.php" {
        return u.query() == Some("basin=atlc")
            && title.contains("atlantic tropical weather outlook");
    }
    if u.query().is_some() {
        return false;
    }
    let Some(path) = u.path().strip_prefix("/text/refresh/") else {
        return false;
    };
    for (prefix, product) in [
        ("MIATCPAT", "public advisory"),
        ("MIATCMAT", "forecast advisory"),
        ("MIATCDAT", "forecast discussion"),
    ] {
        let Some(tail) = path.strip_prefix(prefix) else {
            continue;
        };
        let b = tail.as_bytes();
        if b.len() != 20 || !(b'1'..=b'5').contains(&b[0]) {
            continue;
        }
        if &tail[1..8] == "+shtml/"
            && b[8..14].iter().all(u8::is_ascii_digit)
            && &tail[14..] == ".shtml"
            && title.contains(product)
        {
            return true;
        }
    }
    false
}

fn fed(title: &str, description: &str, raw_url: &str) -> bool {
    let Some(u) = exact_origin(raw_url, "www.federalreserve.gov") else {
        return false;
    };
    if u.query().is_some() {
        return false;
    }
    let Some(p) = u
        .path()
        .strip_prefix("/newsevents/pressreleases/")
        .and_then(|p| p.strip_suffix(".htm"))
    else {
        return false;
    };
    let Some(tail) = ["monetary", "orders", "enforcement", "bcreg", "other"]
        .iter()
        .find_map(|prefix| p.strip_prefix(prefix))
    else {
        return false;
    };
    let b = tail.as_bytes();
    b.len() == 9
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[8].is_ascii_lowercase()
        && [
            "Federal Reserve",
            "Minutes of the Board",
            "Minutes of the Federal Open Market Committee",
        ]
        .iter()
        .any(|prefix| normalized(title).starts_with(prefix))
        && normalized(title) == normalized(description)
}
/// Only called by the bounded parser, never by import. Persist the small result in
/// the private SQLite provenance table, NOT inside exported article JSON.
pub(crate) fn classify(
    source: &Value,
    entry: &feed_rs::model::Entry,
    raw_url: &str,
    article: &Value,
    feed_excluded: bool,
) -> Value {
    let title = entry
        .title
        .as_ref()
        .map(|x| x.content.as_str())
        .unwrap_or("");
    let description = entry
        .summary
        .as_ref()
        .map(|x| x.content.as_str())
        .unwrap_or("");
    let rights = entry
        .rights
        .as_ref()
        .map(|x| x.content.as_str())
        .unwrap_or("");
    // Unexpected author/credit metadata is ambiguous, not a source-wide grant.
    let clean = !feed_excluded
        && !excluded(title)
        && !excluded(description)
        && rights.trim().is_empty()
        && entry.authors.iter().all(|a| {
            source["id"] == "nhc-atlantic"
                && a.name == "author"
                && a.email.as_deref() == Some("nhcwebmaster@noaa.gov (NHC Webmaster)")
                && a.uri.is_none()
        })
        && entry.contributors.is_empty()
        && entry.media.iter().all(|m| m.credits.is_empty());
    let ai = authority(source, "aiAllowed")
        .ok()
        .flatten()
        .is_some_and(|s| {
            clean
                && entry.published.is_some()
                && match s["rightsPolicy"]["aiRule"].as_str() {
                    Some("fed-origin-text-v1") => fed(title, description, raw_url),
                    Some("nhc-origin-text-v1") => nhc(title, description, raw_url),
                    _ => false,
                }
        });
    json!({"policy":policy_revision(source), "input":input_revision(article), "raw":digest(&json!([title,description,rights,raw_url,entry.id])), "ai":ai, "guid":entry.id.chars().take(4096).collect::<String>(), "itemUrl":raw_url, "assets":approved_assets(source, &entry.id, raw_url, article)})
}
/// Only the reviewed asset can supply a MIME absent from feed metadata.
pub(crate) fn supplied_media_mime(
    source: &Value,
    entry: &feed_rs::model::Entry,
    url: &str,
) -> Option<&'static str> {
    let trusted = authority(source, "mediaAllowed").ok().flatten()?;
    trusted["rightsPolicy"]["mediaAllowlist"]
        .as_array()?
        .iter()
        .find(|a| {
            a["itemGuid"] == entry.id
                && a["url"] == url
                && entry.links.iter().any(|l| {
                    l.rel.as_deref().is_none_or(|r| r == "alternate") && a["itemUrl"] == l.href
                })
        })?["mime"]
        .as_str()
}

pub(crate) fn compiled_media_approval(approval: &Value) -> bool {
    catalog().iter().any(|source| {
        source["rightsPolicy"]["mediaAllowlist"]
            .as_array()
            .is_some_and(|list| list.contains(approval))
    })
}

fn approved_assets(source: &Value, guid: &str, raw_url: &str, article: &Value) -> Vec<Value> {
    let Ok(Some(trusted)) = authority(source, "mediaAllowed") else {
        return Vec::new();
    };
    trusted["rightsPolicy"]["mediaAllowlist"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| {
            a["itemGuid"] == guid
                && a["itemUrl"] == raw_url
                && article["media"].as_array().is_some_and(|items| {
                    items
                        .iter()
                        .any(|m| m["url"] == a["url"] && m["kind"] == a["kind"])
                })
        })
        .map(|a| a["url"].clone())
        .collect()
}
pub(crate) fn apply_media_policy(source: &Value, article: &mut Value, proof: &Value) {
    if bundled(source["id"].as_str().unwrap_or("")).is_none() {
        return;
    }
    let approvals = bundled(source["id"].as_str().unwrap_or(""))
        .and_then(|s| s["rightsPolicy"]["mediaAllowlist"].as_array());
    if let Some(items) = article.get_mut("media").and_then(Value::as_array_mut) {
        items.retain(|m| {
            proof["assets"]
                .as_array()
                .is_some_and(|urls| urls.contains(&m["url"]))
        });
        for m in items.iter_mut() {
            if let Some(a) = approvals.and_then(|list| list.iter().find(|a| a["url"] == m["url"])) {
                m["credit"] = a["credit"].clone();
                m["mimeType"] = a["mime"].clone();
                m["caption"] = a.get("caption").cloned().unwrap_or_else(|| {
                    json!("Reviewed media from the linked original article; informational use, no endorsement.")
                });
            }
        }
        if items.is_empty() {
            article.as_object_mut().unwrap().remove("media");
        }
    }
}

pub(crate) fn feed_excluded(body: &[u8]) -> bool {
    // feed-rs preserves standard item rights/credits. RSS item copyright and
    // unknown rights extensions are not standardized: reject the entire feed
    // conservatively rather than silently losing such metadata. The sole NHC
    // channel value "none" is an explicit absence of copyright, not an exception.
    let raw = String::from_utf8_lossy(body)
        .to_ascii_lowercase()
        .replace("<copyright>none</copyright>", "");
    [
        "<copyright",
        "<rights",
        ":rights",
        ":license",
        "<license",
        "<credit",
        ":credit",
    ]
    .iter()
    .any(|tag| raw.contains(tag))
}

/// Strict, bounded backup schema; syntactic validity does NOT confer permission.
pub fn validate_policy(p: &Value) -> Result<(), String> {
    fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
        if v.as_object()
            .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
        {
            return Err("Unknown rights policy field".into());
        }
        Ok(())
    }
    fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
        v[key]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
            .ok_or_else(|| format!("Invalid rights {key}"))
    }
    keys(
        p,
        &[
            "version",
            "requiresItemGate",
            "aiRule",
            "mediaRule",
            "attribution",
            "outputLabel",
            "mediaAllowlist",
        ],
    )?;
    if p["version"].as_u64() != Some(1) || p["requiresItemGate"] != true {
        return Err("Unsupported rights policy version/gate".into());
    }
    text(p, "attribution")?;
    let ai = p.get("aiRule");
    let media = p.get("mediaRule");
    if ai.is_some() == media.is_some() {
        return Err("Invalid rights rule combination".into());
    }
    if let Some(ai) = ai {
        if !matches!(
            ai.as_str(),
            Some("nhc-origin-text-v1" | "fed-origin-text-v1")
        ) || p.get("mediaAllowlist").is_some()
        {
            return Err("Unsupported AI rights rule".into());
        }
        text(p, "outputLabel")?;
    }
    if let Some(media) = media {
        if !matches!(
            media.as_str(),
            Some(
                "nasa-exact-assets-v1"
                    | "mit-exact-media-download-v1"
                    | "esa-standard-licence-exact-assets-v1"
                    | "fed-exact-diagram-v1"
            )
        ) {
            return Err("Unsupported media rights rule".into());
        }
        let assets = p["mediaAllowlist"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 16)
            .ok_or("Invalid media approvals")?;
        let mut seen = std::collections::HashSet::new();
        for a in assets {
            keys(
                a,
                &[
                    "itemGuid",
                    "itemUrl",
                    "url",
                    "kind",
                    "mime",
                    "credit",
                    "caption",
                    "evidenceUrl",
                    "sha256",
                    "integrity",
                    "bytes",
                ],
            )?;
            for key in ["itemGuid", "itemUrl", "url", "evidenceUrl"] {
                crate::services::public_url(text(a, key)?)?;
            }
            text(a, "credit")?;
            if a.get("caption").is_some() {
                text(a, "caption")?;
            }
            let limit = match (a["kind"].as_str(), a["mime"].as_str()) {
                (Some("image"), Some("image/png"))
                    if media == "fed-exact-diagram-v1" || media == "nasa-exact-assets-v1" =>
                {
                    crate::media::IMAGE_LIMIT
                }
                (Some("image"), Some("image/jpeg")) => crate::media::IMAGE_LIMIT,
                (Some("video"), Some("video/mp4")) => crate::media::VIDEO_LIMIT,
                _ => return Err("Invalid approved media format".into()),
            };
            if a["bytes"]
                .as_u64()
                .is_none_or(|n| n == 0 || n > limit as u64)
            {
                return Err("Invalid approved byte count".into());
            }
            let sha_required = media == "nasa-exact-assets-v1" || media == "fed-exact-diagram-v1";
            if sha_required {
                let hash = text(a, "sha256")?;
                if hash.len() != 64
                    || !hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                {
                    return Err("Invalid approved SHA-256".into());
                }
            } else {
                if a.get("sha256").is_some() {
                    return Err("Unexpected unhashed-media SHA-256 field".into());
                }
                if a["integrity"].as_str() != Some("size-mime-reviewed-no-hash") {
                    return Err("Unhashed media must declare reviewed integrity limits".into());
                }
            }
            if !seen.insert((
                a["itemGuid"].clone().to_string(),
                a["url"].clone().to_string(),
            )) {
                return Err("Duplicate media approval".into());
            }
        }
    }
    if p.get("outputLabel").is_some() {
        text(p, "outputLabel")?;
    }
    Ok(())
}
