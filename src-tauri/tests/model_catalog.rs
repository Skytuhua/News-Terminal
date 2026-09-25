use news_terminal_lib::models::{diff_snapshots, parse_openrouter_snapshot};
use serde_json::json;

#[test]
fn openrouter_snapshot_preserves_ids_modalities_prices_and_dates() {
    let raw = json!({
        "total_count": 1,
        "links": {"next": null},
        "data": [{
            "id": "openai/gpt-fixture",
            "name": "GPT Fixture",
            "created": 1790000000,
            "context_length": 128000,
            "architecture": {"input_modalities":["text"],"output_modalities":["text","image"],"tokenizer":"fixture","instruct_type":null},
            "pricing": {"prompt":"0","completion":"0.000001","request":"0"},
            "top_provider": {"context_length": 128000, "max_completion_tokens": 4096, "is_moderated": true},
            "supported_parameters": ["tools", "response_format"],
            "description": "Fixture model"
        }]
    });
    let snapshot = parse_openrouter_snapshot(&raw, 1_800_000_000).unwrap();
    assert_eq!(snapshot["complete"], true);
    assert_eq!(snapshot["totalCount"], 1);
    assert_eq!(snapshot["models"][0]["id"], "openai/gpt-fixture");
    assert_eq!(snapshot["models"][0]["addedToOpenRouter"], 1790000000);
    assert_eq!(snapshot["models"][0]["observedAt"], 1_800_000_000);
    assert_eq!(
        snapshot["models"][0]["outputModalities"],
        json!(["text", "image"])
    );
    assert_eq!(snapshot["models"][0]["pricing"]["prompt"], "0");
    assert_eq!(
        snapshot["models"][0]["releaseDateLabel"],
        "Added to OpenRouter"
    );
}

#[test]
fn model_diff_never_floods_on_first_sync_or_removes_on_partial_reads() {
    let previous = parse_openrouter_snapshot(
        &json!({"total_count":1,"links":{"next":null},"data":[{"id":"vendor/old","name":"Old","created":10,"context_length":1,"architecture":{"input_modalities":["text"],"output_modalities":["text"]},"pricing":{},"supported_parameters":[]}]}),
        100,
    ).unwrap();
    let next = parse_openrouter_snapshot(
        &json!({"total_count":1,"links":{"next":null},"data":[{"id":"vendor/new","name":"New","created":20,"context_length":2,"architecture":{"input_modalities":["text"],"output_modalities":["text"]},"pricing":{},"supported_parameters":["tools"]}]}),
        200,
    ).unwrap();
    assert!(
        diff_snapshots(None, &next, true).is_empty(),
        "first sync seeds a baseline"
    );
    let changes = diff_snapshots(Some(&previous), &next, false);
    assert_eq!(changes.len(), 2);
    assert!(changes
        .iter()
        .any(|c| c["kind"] == "added" && c["modelId"] == "vendor/new"));
    assert!(changes
        .iter()
        .any(|c| c["kind"] == "removed" && c["modelId"] == "vendor/old"));

    let mut partial = next.clone();
    partial["complete"] = json!(false);
    let changes = diff_snapshots(Some(&previous), &partial, false);
    assert!(
        changes.is_empty(),
        "partial snapshots cannot publish any changes"
    );
}
