//! Exact ranking parity with the frozen pre-v0.4 algorithm.
#[allow(dead_code)]
#[path = "../src/intelligence.rs"]
mod intelligence;
use serde_json::{json, Value};
const NOW: i64 = 1_790_184_000;
const RELAXED: &str = "Source diversity cap relaxed: insufficient alternative-source coverage";

mod legacy {
    // Frozen pre-optimization implementation: full JSON parity oracle.
    use serde_json::{json, Value};
    use std::collections::HashMap;
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
        let mut out = Vec::new();
        let mut counts: HashMap<String, usize> = HashMap::new();
        // ponytail: bounded 5,000-item cache; greedy prefix cap, no opaque optimization model.
        while !articles.is_empty() {
            let allowed = (((out.len() + 1) as f64) * cap).ceil() as usize;
            let index = articles.iter().position(|a| {
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
}

fn fixture(n: usize, sources: usize) -> Vec<Value> {
    (0..n)
        .rev()
        .map(|i| {
            json!({
                "id": format!("story-{i:06}"), "sourceId": format!("source-{}", i % sources),
                "title": if i % 2 == 0 { "Science needle" } else { "Other news" },
                "excerpt": if i % 3 == 0 { "excluded" } else { "permitted" },
                "topics": if i % 2 == 0 { vec!["science"] } else { vec!["world"] },
                "region": if i % 3 == 0 { "eu" } else { "world" },
                "language": if i % 3 == 0 { "fr" } else { "en" },
                "publishedAt": NOW - (i as i64 / 3) * 3600,
                "firstSeen": NOW - (i as i64 / 5) * 3600,
                "saved": i >= 5000, "read": i % 3 == 0,
                "reasons": ["stale reason"], "score": -999,
                "opaque": {"retained": [true, null, i]}
            })
        })
        .collect()
}
fn parity(input: Vec<Value>, preferences: Value) -> Vec<Value> {
    let expected = legacy::rank(input.clone(), &preferences, NOW);
    let actual = intelligence::rank(input, &preferences, NOW);
    assert_eq!(actual, expected, "preferences: {preferences}");
    actual
}
#[test]
fn parity_single_source_caps_ties_and_missing_fields() {
    for cap in [0.0, 0.1, 0.5, 0.75, 0.9, 1.0, 1.5, -0.5] {
        for n in [0, 1, 2, 3, 10, 31, 128] {
            parity(fixture(n, 1), json!({"diversityCap":cap}));
            let mut input = fixture(n, 1);
            for (i, a) in input.iter_mut().enumerate() {
                a["publishedAt"] = match i % 4 {
                    0 => Value::Null,
                    1 => json!("invalid"),
                    2 => json!(NOW + 3600),
                    _ => json!(i64::MIN),
                };
                a["firstSeen"] = Value::Null;
                a["id"] = if i % 2 == 0 {
                    Value::Null
                } else {
                    json!("tie")
                };
                let o = a.as_object_mut().unwrap();
                match i % 4 {
                    0 => {
                        o.remove("sourceId");
                    }
                    1 => {
                        o.insert("sourceId".into(), Value::Null);
                    }
                    2 => {
                        o.insert("sourceId".into(), json!(""));
                    }
                    _ => {
                        o.insert("sourceId".into(), json!(42));
                    }
                }
            }
            parity(input, json!({"diversityCap":cap}));
        }
    }
    parity(fixture(41, 1), json!({}));
    parity(fixture(41, 1), json!({"diversityCap":"invalid"}));
}
#[test]
fn parity_preferences_saved_bypass_and_filtered_single_source() {
    let mut input = fixture(120, 3);
    for (i, a) in input.iter_mut().enumerate() {
        a["saved"] = json!(i % 7 == 0);
    }
    for cap in [0.1, 0.5, 1.0] {
        for preferences in [
            json!({"sources":["source-1"]}),
            json!({"sources":["absent"]}),
            json!({"excludeKeywords":["EXCLUDED"]}),
            json!({"topics":["science","science"],"keywords":["NEEDLE","needle"]}),
            json!({"regions":["world"],"languages":["en"]}),
            json!({"sources":["source-0"],"regions":["eu"],"languages":["fr"],
                "topics":["science"],"keywords":["needle"],"excludeKeywords":["excluded"]}),
        ] {
            let mut preferences = preferences;
            preferences["diversityCap"] = json!(cap);
            parity(input.clone(), preferences.clone());
            let unsaved = input
                .iter()
                .cloned()
                .map(|mut a| {
                    a["saved"] = json!(false);
                    a
                })
                .collect();
            parity(unsaved, preferences);
        }
    }
}
#[test]
fn parity_mixed_source_balanced_skew_and_empty_tail() {
    for cap in [0.0, 0.1, 0.5, 0.75, 0.9, 1.0] {
        for sources in [2, 3, 19] {
            parity(fixture(150, sources), json!({"diversityCap":cap}));
            let mut skew = fixture(150, sources);
            for a in skew.iter_mut().skip(5) {
                a["sourceId"] = json!("source-0");
            }
            parity(skew, json!({"diversityCap":cap}));
        }
    }
}
#[test]
fn single_source_diversity_candidate_work_is_linear() {
    for n in [128, 256, 512] {
        intelligence::DIVERSITY_CANDIDATE_VISITS.set(0);
        let result = intelligence::rank(fixture(n, 1), &json!({"diversityCap":0.5}), NOW);
        assert_eq!(result.len(), n);
        let visits = intelligence::DIVERSITY_CANDIDATE_VISITS.get();
        assert!(
            visits <= 2 * n,
            "{n} rows visited {visits} diversity candidates; expected <= {}",
            2 * n
        );
    }
}
#[test]
fn parity_saved_overflow_is_not_truncated() {
    let result = parity(fixture(5103, 1), json!({"diversityCap":0.5}));
    assert_eq!(result.len(), 5103);
    assert_eq!(result.iter().filter(|a| a["saved"] == true).count(), 103);
}
#[test]
fn relaxation_reason_matches_each_prefix_not_just_first_item() {
    for cap in [0.0, 0.1, 0.5, 0.75, 0.9, 1.0] {
        let result = parity(fixture(40, 1), json!({"diversityCap":cap}));
        for (index, a) in result.iter().enumerate() {
            let allowed = (((index + 1) as f64) * cap).ceil() as usize;
            let reasons = a["reasons"].as_array().unwrap();
            assert_eq!(reasons.iter().any(|r| r == RELAXED), index >= allowed);
            if index >= allowed {
                assert_eq!(reasons.last().unwrap(), RELAXED);
            }
        }
    }
}
