use news_terminal_lib::{db::Database, Backend};
use serde_json::json;

#[tokio::test]
async fn zero_paid_mode_preserves_cloud_settings_but_blocks_execution() {
    let mut db = Database::memory().unwrap();
    let now = 1_800_000_000;
    let source = db
        .request(
            &json!({
                "op":"source_add",
                "name":"Permitted Custom",
                "url":"https://example.org/feed",
                "termsUrl":"https://example.org/terms",
                "topics":["ai"],
                "language":"en",
                "region":"world",
                "kind":"official notice",
                "storage":"excerpt",
                "aiAllowed":true
            }),
            now,
        )
        .unwrap();
    db.ingest(
        source["id"].as_str().unwrap(),
        &json!({"articles":[{
            "title":"OpenAI model release",
            "url":"https://example.org/model",
            "excerpt":"A permitted feed excerpt for a model release."
        }]}),
        now,
    )
    .unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let host = Backend::new(db);
    host.execute(json!({
        "op":"provider_save",
        "provider":{"id":"gemini","kind":"gemini","name":"Gemini","model":"gemini-2.5-flash","enabled":true,"consented":true}
    }))
    .await
    .unwrap();
    let providers = host
        .execute(json!({"op":"snapshot","profileId":"default"}))
        .await
        .unwrap()["providers"]
        .clone();
    assert!(providers
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == "gemini" && p["enabled"] == true));

    let error = host
        .execute(json!({
            "op":"summarize",
            "profileId":"default",
            "articleId":article["id"],
            "requestId":"free-mode-cloud-block"
        }))
        .await
        .unwrap_err();
    assert!(
        error.contains("Zero-paid mode blocks cloud AI providers"),
        "{error}"
    );
}
