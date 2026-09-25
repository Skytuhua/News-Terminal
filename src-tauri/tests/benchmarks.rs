use news_terminal_lib::benchmarks::{parse_arena_rows, parse_swebench_leaderboard};
use serde_json::{json, Value};

fn arena() -> Value {
    serde_json::from_str(include_str!("fixtures/metadata/arena.json")).unwrap()
}
fn swe() -> Value {
    serde_json::from_str(include_str!("fixtures/metadata/swe.json")).unwrap()
}

#[test]
fn arena_real_schema_preserves_bounds_votes_date_and_dataset_not_model_license() {
    let raw = arena();
    let parsed = parse_arena_rows(&raw, 1800000000).unwrap();
    let row = &parsed["rows"][0];
    assert_eq!(row["confidenceLow"], raw["rows"][0]["row"]["rating_lower"]);
    assert_eq!(row["confidenceHigh"], raw["rows"][0]["row"]["rating_upper"]);
    assert_eq!(row["votes"], raw["rows"][0]["row"]["vote_count"]);
    assert_eq!(row["publishedAt"], "2026-09-13");
    assert_eq!(row["license"], "CC BY 4.0");
    assert_eq!(row["modelLicense"], "Proprietary");
    assert_eq!(row["configuration"], "text / latest / overall");
    let mut missing = raw.clone();
    missing["rows"][0]["row"]["rating"] = Value::Null;
    assert!(parse_arena_rows(&missing, 1).unwrap()["rows"][0]["value"].is_null());
    for (key, value) in [("category", json!("unknown")), ("rating", json!("bad"))] {
        let mut bad = raw.clone();
        bad["rows"][0]["row"][key] = value;
        assert!(parse_arena_rows(&bad, 1).is_err());
    }
    let mut partial = raw;
    partial["partial"] = json!(true);
    assert!(parse_arena_rows(&partial, 1).is_err());
}

#[test]
fn swebench_real_verified_schema_keeps_percent_and_system_configuration() {
    let raw = swe();
    let parsed = parse_swebench_leaderboard(&raw, 1800000000).unwrap();
    let row = &parsed["rows"][0];
    assert_eq!(row["value"], 79.2);
    assert_eq!(row["unit"], "percent");
    assert_eq!(row["agent"], "Sonar Foundation Agent");
    assert_eq!(row["modelIdentity"], "Claude 4.5 Opus");
    assert_eq!(
        row["submissionId"],
        raw["leaderboards"][0]["results"][0]["folder"]
    );
    assert_eq!(row["publishedAt"], "2025-12-05");
    assert_eq!(parsed["license"], "CC BY-NC 4.0");
    assert_eq!(parsed["rows"].as_array().unwrap().len(), 2);
    let mut missing = raw.clone();
    missing["leaderboards"][0]["results"][0]["resolved"] = Value::Null;
    assert!(parse_swebench_leaderboard(&missing, 1).unwrap()["rows"][0]["value"].is_null());
    let mut malformed = raw.clone();
    malformed["leaderboards"][0]["results"][0]["tags"] = json!({"bad":true});
    assert!(parse_swebench_leaderboard(&malformed, 1).is_err());
    let mut bad = raw;
    bad["leaderboards"][0]["results"][0]["resolved"] = json!(101);
    assert!(parse_swebench_leaderboard(&bad, 1).is_err());
    assert!(parse_swebench_leaderboard(&json!({"verified":[]}), 1).is_err());
}
