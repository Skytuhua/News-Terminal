use news_terminal_lib::models::{
    assemble_openrouter_pages, parse_huggingface_models, validate_openrouter_next,
};
use serde_json::{json, Value};
#[test]
fn pagination_requires_consistent_totals_unique_ids_and_terminal_links() {
    let raw: Value =
        serde_json::from_str(include_str!("fixtures/metadata/openrouter.json")).unwrap();
    let mut first = raw.clone();
    first["data"] = json!([raw["data"][0].clone()]);
    first["links"]["next"] = json!("/api/v1/models?output_modalities=all&offset=1&limit=500");
    let mut last = raw.clone();
    last["data"] = json!([raw["data"][1].clone()]);
    assert_eq!(
        assemble_openrouter_pages(&[first.clone(), last.clone()], 1).unwrap()["totalCount"],
        2
    );
    assert!(assemble_openrouter_pages(&[first.clone()], 1).is_err());
    last["total_count"] = json!(3);
    assert!(assemble_openrouter_pages(&[first, last], 1).is_err());
    let base = "https://openrouter.ai/api/v1/models?output_modalities=all&offset=0&limit=500";
    assert!(validate_openrouter_next(
        base,
        "/api/v1/models?output_modalities=all&offset=500&limit=500",
        500
    )
    .is_ok());
    for url in [
        "https://evil.example/api/v1/models?offset=500",
        "/api/v1/chat/completions",
        "http://openrouter.ai/api/v1/models",
        "/api/v1/models?offset=0",
        "/api/v1/models?output_modalities=all&offset=500&limit=500&key=secret",
    ] {
        assert!(
            validate_openrouter_next(base, url, 500).is_err(),
            "accepted {url}"
        );
    }
}
#[test]
fn huggingface_selected_verified_organization_metadata_and_subtypes() {
    let raw: Value = serde_json::from_str(include_str!("fixtures/metadata/hf.json")).unwrap();
    let parsed = parse_huggingface_models(&raw, 100).unwrap();
    assert_eq!(parsed["models"][0]["id"], raw[0]["id"]);
    assert_eq!(
        parsed["models"][0]["repositoryCreated"],
        raw[0]["createdAt"]
    );
    assert_eq!(
        parsed["models"][0]["repositoryUpdated"],
        raw[0]["lastModified"]
    );
    assert_eq!(parsed["models"][0]["license"], "other");
    assert_eq!(
        parsed["scope"],
        "Newest 50 public repositories from Qwen; not a complete organization archive"
    );
    let mut other = raw.clone();
    other[0]["author"] = json!("attacker");
    assert!(parse_huggingface_models(&other, 1).is_err());
    let mut invalid = raw.clone();
    invalid[0]["cardData"]["license"] = json!({"unexpected":true});
    assert!(parse_huggingface_models(&invalid, 1).is_err());
    let mut derived = raw;
    derived[0]["tags"] = json!(["base_model:quantized:Qwen/base"]);
    derived[0]["cardData"]["base_model"] = json!(["Qwen/base"]);
    let rows = parse_huggingface_models(&derived, 1).unwrap();
    assert_eq!(rows["models"][0]["subtype"], "quantization");
    assert_eq!(rows["models"][0]["baseModels"], json!(["Qwen/base"]));
}
