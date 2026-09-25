//! Profile-scoped calendar-day coverage and deterministic headline outlines.
use chrono::{Local, NaiveDate, TimeZone};
use serde_json::{json, Value};

pub const SECTORS: [(&str, &str); 11] = [
    ("politics", "Politics"),
    ("business", "Business"),
    ("markets", "Markets"),
    ("technology", "Technology"),
    ("science", "Science"),
    ("health", "Health"),
    ("weather", "Weather"),
    ("climate", "Climate"),
    ("sports", "Sports"),
    ("entertainment", "Entertainment"),
    ("culture", "Culture"),
];
pub const FOCUS_SECTIONS: [(&str, &str); 4] = [
    ("ai", "AI"),
    ("technology", "Technology"),
    ("stocks", "Stocks"),
    ("others", "Others"),
];

#[derive(Debug, Clone)]
pub struct DayBounds {
    pub date: String,
    pub start: i64,
    pub end: i64,
}

/// Resolve the leading timezone gap, retaining the earlier instant of a fold.
/// Offsets have whole-second precision. Hourly probes bracket the end of the
/// contiguous leading gap; bisection then finds its exact second, not a rounded
/// hour/minute. At most 37 local lookups per date, and just one on ordinary days.
fn first_valid_in_date<T: TimeZone>(date: NaiveDate, zone: &T) -> Option<i64> {
    let midnight = date.and_hms_opt(0, 0, 0)?;
    let resolve = |seconds| {
        zone.from_local_datetime(&(midnight + chrono::Duration::seconds(seconds)))
            .earliest()
            .map(|t| t.timestamp())
    };
    if let Some(instant) = resolve(0) {
        return Some(instant);
    }
    let mut low = 0;
    for hour in 1..=24 {
        let mut high = (hour * 3600).min(86_399);
        if let Some(mut instant) = resolve(high) {
            while high - low > 1 {
                let middle = low + (high - low) / 2;
                if let Some(candidate) = resolve(middle) {
                    high = middle;
                    instant = candidate;
                } else {
                    low = middle;
                }
            }
            return Some(instant);
        }
        low = high;
    }
    None
}

/// Half-open local calendar day, starting at its first real instant (not
/// necessarily midnight). Resolve the next boundary independently for DST.
/// An entirely skipped requested date is an explicit error, not another date's
/// report. If the following date is skipped by a date-line jump, the previous
/// real day ends at the first instant of the date after that. This lookahead is
/// bounded: a single offset jump (Chrono offsets are strictly within +/-24h)
/// cannot skip two complete dates.
pub fn bounds_in_timezone<T: TimeZone>(date: NaiveDate, zone: &T) -> Result<DayBounds, String> {
    let next = date.succ_opt().ok_or("Date outside supported calendar")?;
    let start = first_valid_in_date(date, zone)
        .ok_or("Local calendar date does not exist in this timezone")?;
    let end = match first_valid_in_date(next, zone) {
        Some(end) => end,
        None => {
            let after_skipped = next.succ_opt().ok_or("Date outside supported calendar")?;
            first_valid_in_date(after_skipped, zone)
                .ok_or("No local calendar boundary after skipped date")?
        }
    };
    Ok(DayBounds {
        date: date.format("%Y-%m-%d").to_string(),
        start,
        end,
    })
}

pub fn local_day(date: Option<&str>, now: i64) -> Result<DayBounds, String> {
    let today = Local
        .timestamp_opt(now, 0)
        .single()
        .ok_or("Invalid current timestamp")?
        .date_naive();
    let date = match date {
        Some(raw) => {
            if raw.len() != 10
                || !raw.bytes().enumerate().all(|(i, b)| {
                    if i == 4 || i == 7 {
                        b == b'-'
                    } else {
                        b.is_ascii_digit()
                    }
                })
            {
                return Err("Date must be YYYY-MM-DD".into());
            }
            let d = NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| "Date must be YYYY-MM-DD")?;
            if d.format("%Y-%m-%d").to_string() != raw {
                return Err("Date must be YYYY-MM-DD".into());
            }
            d
        }
        None => today,
    };
    bounds_in_timezone(date, &Local)
}

fn values(v: &Value) -> Vec<&str> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn profile_matches(a: &Value, p: &Value) -> bool {
    let hay = format!(
        "{} {}",
        a["title"].as_str().unwrap_or(""),
        a["excerpt"].as_str().unwrap_or("")
    )
    .to_lowercase();
    a["hidden"] != true
        && !values(&p["excludeKeywords"])
            .iter()
            .any(|k| hay.contains(&k.to_lowercase()))
        && [
            ("regions", "region"),
            ("languages", "language"),
            ("sources", "sourceId"),
        ]
        .iter()
        .all(|(preference, key)| {
            let terms = values(&p[preference]);
            terms.is_empty() || terms.contains(&a[key].as_str().unwrap_or(""))
        })
        && crate::intelligence::matches(p, a)
}

fn sector(id: &str, title: &str, entries: &[&Value]) -> Value {
    let sources: std::collections::HashSet<&str> = entries
        .iter()
        .filter_map(|a| a["sourceId"].as_str())
        .collect();
    let split = |v: &Value| {
        v["groupId"]
            .as_str()
            .is_some_and(|g| g.starts_with("split:"))
    };
    let mut representatives: Vec<&Value> = Vec::new();
    for a in entries {
        if !representatives.iter().any(|b| {
            !split(a) && !split(b) && a["kind"] == b["kind"] && crate::intelligence::related(a, b)
        }) {
            representatives.push(a);
            if representatives.len() == 12 {
                break;
            }
        }
    }
    let items: Vec<Value> = representatives
        .iter()
        .map(|a| {
            json!({
                "id":a["id"], "title":a["title"], "url":a["url"],
                "sourceId":a["sourceId"], "sourceName":a["sourceName"],
                "publishedAt":a["publishedAt"], "kind":a["kind"],
                "excerpt":a["excerpt"], "aiAllowed":a["aiAllowed"]
            })
        })
        .collect();
    let outline = if items.is_empty() {
        vec![
            "No retrieved dated coverage for this sector in this profile and calendar day."
                .to_owned(),
        ]
    } else {
        items
            .iter()
            .map(|a| {
                format!(
                    "Headline (not AI): {} — {} [{}] — {}",
                    a["title"].as_str().unwrap_or(""),
                    a["sourceName"].as_str().unwrap_or(""),
                    a["kind"].as_str().unwrap_or(""),
                    a["url"].as_str().unwrap_or("")
                )
            })
            .collect()
    };
    json!({"id":id,"title":title,"articleCount":entries.len(),"sourceCount":sources.len(),"items":items,"outline":outline})
}

/// Pure report builder; callers supply profile-overlay articles and explicit bounds.
/// Saved stories deliberately do not bypass profile filters in a coverage report.
pub fn build(articles: &[Value], preferences: &Value, day: &DayBounds, now: i64) -> Value {
    let matching: Vec<&Value> = articles
        .iter()
        .filter(|a| profile_matches(a, preferences))
        .collect();
    let in_day = |t: i64| t >= day.start && t < day.end && t <= now;
    let undated_count = matching
        .iter()
        .filter(|a| {
            a["publishedAt"].as_i64().is_none() && a["firstSeen"].as_i64().is_some_and(in_day)
        })
        .count();
    let mut dated: Vec<&Value> = matching
        .into_iter()
        .filter(|a| a["publishedAt"].as_i64().is_some_and(in_day))
        .collect();
    dated.sort_by(|a, b| {
        b["publishedAt"]
            .as_i64()
            .cmp(&a["publishedAt"].as_i64())
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    // Bucket once rather than scanning the complete cache for every custom topic.
    let mut buckets: std::collections::BTreeMap<&str, Vec<&Value>> =
        std::collections::BTreeMap::new();
    let mut focus_buckets: std::collections::BTreeMap<&str, Vec<&Value>> =
        std::collections::BTreeMap::new();
    for a in &dated {
        let mut sections: std::collections::BTreeSet<&str> =
            values(&a["sections"]).into_iter().collect();
        if sections.is_empty() {
            sections.insert("others");
        }
        for section in sections {
            if FOCUS_SECTIONS.iter().any(|(id, _)| id == &section) {
                focus_buckets.entry(section).or_default().push(a);
            }
        }
        let mut topics: std::collections::BTreeSet<&str> =
            values(&a["topics"]).into_iter().collect();
        if topics.is_empty() {
            topics.insert("unclassified");
        }
        for topic in topics {
            buckets.entry(topic).or_default().push(a);
        }
    }
    let mut sector_names = FOCUS_SECTIONS.to_vec();
    sector_names.extend(
        SECTORS
            .iter()
            .copied()
            .filter(|(id, _)| !FOCUS_SECTIONS.iter().any(|(focus, _)| focus == id)),
    );
    sector_names.extend(
        buckets
            .keys()
            .copied()
            .filter(|id| {
                !SECTORS.iter().any(|(standard, _)| standard == id)
                    && !FOCUS_SECTIONS.iter().any(|(focus, _)| focus == id)
            })
            .map(|id| {
                (
                    id,
                    if id == "unclassified" {
                        "Unclassified"
                    } else {
                        id
                    },
                )
            }),
    );
    let sectors: Vec<Value> = sector_names
        .iter()
        .map(|(id, title)| {
            let entries = focus_buckets
                .get(id)
                .or_else(|| buckets.get(id))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            sector(id, title, entries)
        })
        .collect();
    json!({"date":day.date,"dayStart":day.start,"dayEnd":day.end,"generatedAt":now,
        "coverageLabel":"Retrieved, locally retained profile-matching coverage only, not all world events. Deterministic headline outline, not an AI summary. Counts are original articles and distinct sources before conservative grouping; at most 12 representative headlines per sector. Sector counts overlap for multi-topic stories; undated items first retrieved this day are excluded from publication-day counts.",
        "articleCount":dated.len(),"undatedCount":undated_count,"sectors":sectors})
}
