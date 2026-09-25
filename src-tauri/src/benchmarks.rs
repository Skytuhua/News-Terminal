use serde_json::{json, Value};
use std::collections::HashSet;

pub const ARENA_ROWS_URL: &str = "https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest";
pub const SWEBENCH_URL: &str =
    "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json";
pub const COMPARISON_NOTE: &str = "No universal score. Arena preference ratings and SWE-bench resolved rates use different methods, licenses and units.";

fn text(value: &Value, key: &str, max: usize) -> Option<String> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn number(value: &Value, key: &str, bounds: Option<(f64, f64)>) -> Result<Value, String> {
    let v = &value[key];
    if v.is_null() {
        return Ok(Value::Null);
    }
    let n = v
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| format!("Invalid benchmark {key}"))?;
    if bounds.is_some_and(|(lo, hi)| n < lo || n > hi) {
        return Err(format!("Out-of-range benchmark {key}"));
    }
    Ok(v.clone())
}

// Only the reviewed text/latest/overall configuration is supported, not all Arena modalities.
pub fn parse_arena_rows(raw: &Value, observed_at: i64) -> Result<Value, String> {
    let rows = raw["rows"]
        .as_array()
        .ok_or("Arena response missing rows")?;
    let total = raw["num_rows_total"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 2000)
        .or_else(|| {
            // /rows fixtures may report all text categories; production uses /filter.
            raw["num_rows_total"].as_u64().filter(|n| *n <= 20000)
        })
        .ok_or("Invalid Arena total")?;
    if rows.is_empty() || rows.len() > 2000 || raw["partial"] != false {
        return Err("Incomplete or oversized Arena response".into());
    }
    let mut parsed = Vec::new();
    let mut ids = HashSet::new();
    let mut publication = None;
    for wrapper in rows {
        if wrapper["truncated_cells"]
            .as_array()
            .is_none_or(|v| !v.is_empty())
        {
            return Err("Truncated Arena cells".into());
        }
        let row = &wrapper["row"];
        let model = text(row, "model_name", 240).ok_or("Arena row missing model_name")?;
        let category = text(row, "category", 120).ok_or("Arena row missing category")?;
        if category != "overall" || !ids.insert(model.clone()) {
            return Err("Unsupported or duplicate Arena row".into());
        }
        let published = text(row, "leaderboard_publish_date", 40)
            .ok_or("Arena row missing publication date")?;
        if publication.as_ref().is_some_and(|p| p != &published) {
            return Err("Arena publication changed during snapshot".into());
        }
        publication = Some(published.clone());
        let low = number(row, "rating_lower", None)?;
        let high = number(row, "rating_upper", None)?;
        if low.as_f64().zip(high.as_f64()).is_some_and(|(l, h)| l > h) {
            return Err("Inverted Arena confidence bounds".into());
        }
        parsed.push(json!({
            "source":"Arena leaderboard dataset", "benchmark":"Arena Text", "model":model,
            "organization":text(row,"organization",240), "modelLicense":text(row,"license",240),
            "category":category, "configuration":"text / latest / overall", "version":published,
            "metric":"Arena preference rating", "unit":"rating", "value":number(row,"rating",None)?,
            "confidenceLow":low, "confidenceHigh":high,
            "votes":number(row,"vote_count",Some((0.0,1e12)))?, "rank":number(row,"rank",Some((1.0,1e6)))?,
            "publishedAt":published, "observedAt":observed_at, "higherIsBetter":true,
            "license":"CC BY 4.0", "sourceUrl":"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset"
        }));
    }
    Ok(
        json!({"source":"Arena leaderboard dataset", "license":"CC BY 4.0",
        "licenseUrl":"https://creativecommons.org/licenses/by/4.0/",
        "sourceUrl":"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset",
        "attribution":"Arena / LMArena leaderboard dataset (CC BY 4.0)",
        "modifications":"Selected text/latest/overall; fields renamed for display, scores unchanged.",
        "observedAt":observed_at, "complete":rows.len() as u64 == total, "totalCount":total, "rows":parsed}),
    )
}

pub fn parse_swebench_leaderboard(raw: &Value, observed_at: i64) -> Result<Value, String> {
    let boards = raw["leaderboards"]
        .as_array()
        .ok_or("SWE-bench response missing leaderboards")?;
    let verified: Vec<_> = boards.iter().filter(|b| b["name"] == "Verified").collect();
    if verified.len() != 1 {
        return Err("SWE-bench requires exactly one Verified split".into());
    }
    let candidates = verified[0]["results"]
        .as_array()
        .ok_or("SWE-bench missing Verified results")?;
    if candidates.is_empty() || candidates.len() > 1000 {
        return Err("Invalid SWE-bench result count".into());
    }
    let mut rows = Vec::new();
    let mut ids = HashSet::new();
    for item in candidates {
        let model = text(item, "name", 500).ok_or("SWE-bench row missing system name")?;
        if !item["tags"].is_null()
            && item["tags"].as_array().is_none_or(|tags| {
                tags.len() > 100
                    || tags.iter().any(|tag| {
                        tag.as_str()
                            .is_none_or(|s| s.len() > 1000 || s.chars().any(char::is_control))
                    })
            })
        {
            return Err("Invalid SWE-bench configuration tags".into());
        }
        let id = text(item, "folder", 500).ok_or("SWE-bench row missing submission ID")?;
        if !ids.insert(id.clone()) {
            return Err("Duplicate SWE-bench submission".into());
        }
        rows.push(json!({
            "source":"SWE-bench leaderboard", "benchmark":"SWE-bench Verified", "model":model,
            "modelIdentity":text(item,"model_display",500), "agent":text(item,"agent",500),
            "submissionId":id, "configuration":item.get("tags").cloned().unwrap_or(Value::Null),
            "reasoningEffort":item.get("reasoning_effort").cloned().unwrap_or(Value::Null),
            "checked":item.get("checked").cloned().unwrap_or(Value::Null),
            "category":"verified", "version":null, "metric":"Resolved rate", "unit":"percent",
            "value":number(item,"resolved",Some((0.0,100.0)))?, "publishedAt":text(item,"date",40),
            "observedAt":observed_at, "higherIsBetter":true, "license":"CC BY-NC 4.0",
            "sourceUrl":"https://www.swebench.com/", "artifactUrl":SWEBENCH_URL
        }));
    }
    Ok(
        json!({"source":"SWE-bench leaderboard", "license":"CC BY-NC 4.0",
        "licenseUrl":"https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/LICENSE",
        "sourceUrl":"https://www.swebench.com/", "artifactUrl":SWEBENCH_URL,
        "attribution":"SWE-bench website/data contributors (CC BY-NC 4.0); personal noncommercial use only.",
        "modifications":"Selected Verified split; fields renamed for display; resolved percentage unchanged. Verified names the split, not verification of every submission.",
        "observedAt":observed_at, "complete":true, "totalCount":rows.len(), "rows":rows}),
    )
}

pub(crate) async fn fetch_json(url: &str, limit: usize) -> Result<Value, String> {
    let url = crate::services::public_url(url)?;
    let client = crate::services::public_client(&url).await?;
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(45))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Metadata request timed out"
            } else {
                "Metadata connection failed"
            }
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {}; metadata unavailable",
            response.status().as_u16()
        ));
    }
    let body = crate::services::bounded_body(response, limit).await?;
    serde_json::from_slice(&body).map_err(|_| "Invalid metadata JSON".into())
}

pub fn assemble_arena_pages(pages: &[Value], observed_at: i64) -> Result<Value, String> {
    let total = pages
        .first()
        .and_then(|v| v["num_rows_total"].as_u64())
        .filter(|n| *n > 0 && *n <= 12000)
        .ok_or("Invalid Arena total")?;
    let mut index = 0;
    let mut selected = Vec::new();
    for page in pages {
        if page["num_rows_total"].as_u64() != Some(total) || page["partial"] != false {
            return Err("Arena changed total or partial response".into());
        }
        let rows = page["rows"]
            .as_array()
            .filter(|r| !r.is_empty() && r.len() <= 100)
            .ok_or("Invalid Arena page")?;
        for row in rows {
            if row["row_idx"].as_u64() != Some(index)
                || row["truncated_cells"]
                    .as_array()
                    .is_none_or(|v| !v.is_empty())
            {
                return Err("Arena missing/duplicate indexes or truncated cells".into());
            }
            index += 1;
            let category = row["row"]["category"]
                .as_str()
                .ok_or("Missing Arena category")?;
            if category == "overall" {
                selected.push(row.clone());
            }
        }
    }
    if index != total {
        return Err("Incomplete Arena snapshot".into());
    }
    let mut snapshot = parse_arena_rows(
        &json!({"num_rows_total":selected.len(),"rows":selected,"partial":false}),
        observed_at,
    )?;
    snapshot["fetchedRowCount"] = json!(total);
    Ok(snapshot)
}

pub async fn fetch_arena(observed_at: i64) -> Result<Value, String> {
    // Viewer /filter is not reliable for this dataset (live HTTP 500/timeouts).
    // Read the complete text/latest snapshot before selecting overall; never
    // assume category ordering. 120 pages, four requests in flight, daily TTL.
    let first = fetch_json(&format!("{ARENA_ROWS_URL}&offset=0&length=100"), 256 * 1024).await?;
    let total = first["num_rows_total"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 12000)
        .ok_or("Arena total exceeds reviewed bound")? as usize;
    let mut pages = vec![first];
    for start in (100..total).step_by(400) {
        let read = |offset: usize| async move {
            if offset >= total {
                Ok(None)
            } else {
                fetch_json(
                    &format!("{ARENA_ROWS_URL}&offset={offset}&length=100"),
                    256 * 1024,
                )
                .await
                .map(Some)
            }
        };
        let (a, b, c, d) = tokio::join!(
            read(start),
            read(start + 100),
            read(start + 200),
            read(start + 300)
        );
        for page in [a, b, c, d] {
            if let Some(page) = page? {
                pages.push(page);
            }
        }
    }
    assemble_arena_pages(&pages, observed_at)
}
pub async fn fetch_swebench(observed_at: i64) -> Result<Value, String> {
    // Dedicated 8 MiB JSON cap: no change to feed limits, no model weights/logs.
    parse_swebench_leaderboard(
        &fetch_json(SWEBENCH_URL, 8 * 1024 * 1024).await?,
        observed_at,
    )
}
