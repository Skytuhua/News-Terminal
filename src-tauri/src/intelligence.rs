//! Explainable, deterministic ranking and conservative likely-related coverage.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
// Test-only work counter; absent from normal/native benchmark builds.
#[cfg(test)]
std::thread_local! {
    pub(crate) static DIVERSITY_CANDIDATE_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
fn values(v: &Value) -> Vec<&str> {
    v.as_array()
        .map(|v| v.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}
pub fn matches(rule: &Value, a: &Value) -> bool {
    let hay = format!(
        "{} {}",
        a["title"].as_str().unwrap_or(""),
        a["excerpt"].as_str().unwrap_or("")
    )
    .to_lowercase();
    ["keywords", "topics", "sources"].iter().all(|k| {
        let terms = values(&rule[k]);
        terms.is_empty()
            || terms.iter().any(|t| match *k {
                "keywords" => hay.contains(&t.to_lowercase()),
                "topics" => values(&a["topics"]).contains(t),
                _ => a["sourceId"] == *t,
            })
    })
}
pub fn rank(mut articles: Vec<Value>, preferences: &Value, now: i64) -> Vec<Value> {
    articles.retain(|a| {
        if a["saved"] == true {
            return true;
        }
        let hay = format!("{} {}", a["title"], a["excerpt"]).to_lowercase();
        !values(&preferences["excludeKeywords"])
            .iter()
            .any(|k| hay.contains(&k.to_lowercase()))
            && [
                ("regions", "region"),
                ("languages", "language"),
                ("sources", "sourceId"),
            ]
            .iter()
            .all(|(p, k)| {
                let terms = values(&preferences[p]);
                terms.is_empty() || terms.contains(&a[k].as_str().unwrap_or(""))
            })
            && matches(preferences, a)
    });
    for a in &mut articles {
        let timestamp = a["publishedAt"]
            .as_i64()
            .unwrap_or(a["firstSeen"].as_i64().unwrap_or(now));
        let age = now.saturating_sub(timestamp).max(0) / 3600;
        let mut score = 100_i64.saturating_sub(age).max(0);
        let mut reasons = vec![format!(
            "Recency: {age} hours since {}",
            if a["publishedAt"].is_null() {
                "first seen"
            } else {
                "publication"
            }
        )];
        let hay = format!("{} {}", a["title"], a["excerpt"]).to_lowercase();
        for topic in values(&preferences["topics"]) {
            if values(&a["topics"]).contains(&topic) {
                score += 40;
                reasons.push(format!("Topic match: {topic}"));
            }
        }
        for term in values(&preferences["keywords"]) {
            if hay.contains(&term.to_lowercase()) {
                score += 30;
                reasons.push(format!("Keyword match: {term}"));
            }
        }
        for (p, k, label) in [
            ("sources", "sourceId", "Selected source"),
            ("regions", "region", "Region match"),
            ("languages", "language", "Language match"),
        ] {
            if values(&preferences[p]).contains(&a[k].as_str().unwrap_or("")) {
                score += 10;
                reasons.push(format!("{label}: {}", a[k].as_str().unwrap_or("")));
            }
        }
        a["score"] = json!(score);
        a["reasons"] = json!(reasons);
    }
    articles.sort_by(|a, b| {
        b["score"]
            .as_i64()
            .cmp(&a["score"].as_i64())
            .then_with(|| b["firstSeen"].as_i64().cmp(&a["firstSeen"].as_i64()))
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    let cap = preferences["diversityCap"].as_f64().unwrap_or(0.5);
    // One normalized source means every candidate has the same prefix count.
    // Keep the sorted vector, including saved overflow, without rescans or shifts.
    if articles.first().is_some_and(|first| {
        let source = first["sourceId"].as_str().unwrap_or("");
        articles.iter().all(|a| {
            #[cfg(test)]
            DIVERSITY_CANDIDATE_VISITS.set(DIVERSITY_CANDIDATE_VISITS.get() + 1);
            a["sourceId"].as_str().unwrap_or("") == source
        })
    }) {
        for (count, a) in articles.iter_mut().enumerate() {
            let allowed = (((count + 1) as f64) * cap).ceil() as usize;
            if count >= allowed {
                a["reasons"].as_array_mut().unwrap().push(json!(
                    "Source diversity cap relaxed: insufficient alternative-source coverage"
                ));
            }
        }
        return articles;
    }
    let mut out = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    // ponytail: retain mixed-source greedy semantics; skewed tails can still be quadratic.
    while !articles.is_empty() {
        let allowed = (((out.len() + 1) as f64) * cap).ceil() as usize;
        let index = articles.iter().position(|a| {
            #[cfg(test)]
            DIVERSITY_CANDIDATE_VISITS.set(DIVERSITY_CANDIDATE_VISITS.get() + 1);
            counts
                .get(a["sourceId"].as_str().unwrap_or(""))
                .copied()
                .unwrap_or(0)
                < allowed
        });
        let mut a = articles.remove(index.unwrap_or(0));
        if index.is_none() {
            a["reasons"].as_array_mut().unwrap().push(json!(
                "Source diversity cap relaxed: insufficient alternative-source coverage"
            ));
        }
        *counts
            .entry(a["sourceId"].as_str().unwrap_or("").to_owned())
            .or_default() += 1;
        out.push(a);
    }
    out
}
fn tokens(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() > 2)
        .map(str::to_owned)
        .collect()
}
pub fn related(a: &Value, b: &Value) -> bool {
    if a["url"] == b["url"] {
        return true;
    }
    let time = |v: &Value| {
        v["publishedAt"]
            .as_i64()
            .unwrap_or(v["firstSeen"].as_i64().unwrap_or(0))
    };
    if time(a).abs_diff(time(b)) > 48 * 3600 {
        return false;
    }
    // Capitalized tokens are only a conservative entity veto, never an entity/reliability claim.
    // Prefer missed groups to conflating two cities/people in an otherwise identical headline.
    let names = |v: &Value| {
        v["title"]
            .as_str()
            .unwrap_or("")
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| s.chars().count() > 2 && s.chars().next().is_some_and(char::is_uppercase))
            .map(str::to_lowercase)
            .collect::<HashSet<_>>()
    };
    if names(a) != names(b) {
        return false;
    }
    let ta = tokens(a["title"].as_str().unwrap_or(""));
    let tb = tokens(b["title"].as_str().unwrap_or(""));
    if ta.len() < 5 || tb.len() < 5 {
        return false;
    }
    // Different numeric claims and negations are important negative evidence.
    let critical = |t: &HashSet<String>| {
        t.iter()
            .filter(|s| {
                s.chars().any(|c| c.is_numeric())
                    || ["not", "never", "denies"].contains(&s.as_str())
            })
            .cloned()
            .collect::<HashSet<_>>()
    };
    if critical(&ta) != critical(&tb) {
        return false;
    }
    let shared = ta.intersection(&tb).count();
    let union = ta.union(&tb).count();
    shared >= 5 && shared as f64 / union as f64 >= 0.85
}
