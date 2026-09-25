use news_terminal_lib::models::{diff_snapshots, parse_openrouter_snapshot};
use serde_json::{json, Value};
fn raw() -> Value {
    serde_json::from_str(include_str!("fixtures/metadata/openrouter.json")).unwrap()
}
#[test]
fn incomplete_duplicate_or_malformed_catalog_cannot_replace_baseline() {
    let original = raw();
    for kind in [
        "count",
        "links",
        "duplicate",
        "empty",
        "context",
        "pricing",
        "modalities",
    ] {
        let mut v = original.clone();
        match kind {
            "count" => v["total_count"] = json!(3),
            "links" => {
                v.as_object_mut().unwrap().remove("links");
            }
            "duplicate" => v["data"][1] = v["data"][0].clone(),
            "empty" => {
                v["data"] = json!([]);
                v["total_count"] = json!(0);
            }
            "context" => v["data"][0]["context_length"] = json!("oops"),
            "pricing" => v["data"][0]["pricing"]["prompt"] = json!({"bad":true}),
            _ => v["data"][0]["architecture"]["input_modalities"] = json!("text"),
        }
        assert!(
            parse_openrouter_snapshot(&v, 100).is_err(),
            "accepted {kind}"
        );
    }
    let mut paged = original;
    paged["links"]["next"] = json!("/api/v1/models?offset=2");
    assert!(parse_openrouter_snapshot(&paged, 100).is_err());
}
#[test]
fn meaningful_changes_ignore_observation_time_and_keep_unknown_context_null() {
    let original = raw();
    let previous = parse_openrouter_snapshot(&original, 100).unwrap();
    let mut next = original.clone();
    next["data"][0]["pricing"]["prompt"] = json!("0.0123");
    let parsed = parse_openrouter_snapshot(&next, 200).unwrap();
    let diff = diff_snapshots(Some(&previous), &parsed, false);
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0]["kind"], "changed");
    assert!(diff_snapshots(
        Some(&previous),
        &parse_openrouter_snapshot(&original, 200).unwrap(),
        false
    )
    .is_empty());
    next["data"][0]["context_length"] = Value::Null;
    assert!(parse_openrouter_snapshot(&next, 200).unwrap()["models"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["contextLength"].is_null()));
}
