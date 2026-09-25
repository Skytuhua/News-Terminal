use news_terminal_lib::{db::Database, Backend};
use serde_json::json;

#[tokio::test]
async fn media_load_rejects_unknown_article_without_network() {
    let host = Backend::new(Database::memory().unwrap());
    let preferences = host
        .execute(json!({"op":"media_preferences","profileId":"default"}))
        .await
        .unwrap();
    let err = host
        .execute(json!({
            "op":"media_load",
            "profileId":"default",
            "replacementToken":preferences["replacementToken"],
            "articleId":"missing",
            "index":0
        }))
        .await
        .unwrap_err();
    // Reach article lookup, which rejects before constructing the network loader.
    assert_eq!(err, "Unknown article");
}

#[tokio::test]
async fn media_load_rejects_missing_replacement_token_before_article_lookup() {
    let host = Backend::new(Database::memory().unwrap());
    let err = host
        .execute(json!({
            "op":"media_load",
            "profileId":"default",
            "articleId":"missing",
            "index":0
        }))
        .await
        .unwrap_err();
    assert_eq!(err, "Database replaced: reload before making a new change");
}

#[tokio::test]
async fn import_limits_decoded_data_and_other_envelope_fields_separately() {
    let host = Backend::new(Database::memory().unwrap());
    let before = host.database().unwrap().export().unwrap();
    let error = host
        .execute(json!({"op":"import","data":" ".repeat(32 * 1024 * 1024 + 1)}))
        .await
        .unwrap_err();
    assert_eq!(error, "Backup exceeds 32 MiB");
    let error = host
        .execute(json!({"op":"import","data":" ".repeat(32 * 1024 * 1024)}))
        .await
        .unwrap_err();
    assert_eq!(
        error, "Invalid backup JSON",
        "the exact raw limit must reach backup validation"
    );
    for request in [
        json!({"op":"import","data":before,"extra":"x".repeat(64 * 1024)}),
        json!({"op":"import","data":before,"extra":["x".repeat(32 * 1024), "x".repeat(32 * 1024)]}),
        json!({"op":"snapshot","extra":"x".repeat(34 * 1024 * 1024)}),
    ] {
        assert_eq!(
            host.execute(request).await.unwrap_err(),
            "Request exceeds size limit"
        );
    }
    assert_eq!(host.database().unwrap().export().unwrap(), before);
}

#[tokio::test]
async fn exported_quote_heavy_backup_roundtrips_through_host_import() {
    let mut database = Database::memory().unwrap();
    let source = database.request(&json!({"op":"source_add","name":"Quotes","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), 1000).unwrap();
    for batch in 0..10 {
        let articles: Vec<_> = (0..500)
            .map(|i| {
                json!({
                    "title":format!("Quote story {}", batch * 500 + i),
                    "url":format!("https://example.org/{}", batch * 500 + i),
                    "excerpt":"\"".repeat(2000)
                })
            })
            .collect();
        database
            .ingest(
                source["id"].as_str().unwrap(),
                &json!({"articles":articles}),
                1000,
            )
            .unwrap();
    }
    let backup = database.export().unwrap();
    assert!(backup.len() < 32 * 1024 * 1024);
    Database::memory().unwrap().import(&backup).unwrap();
    let request = json!({"op":"import","data":backup});
    assert!(request.to_string().len() > 34 * 1024 * 1024);
    let host = Backend::new(database);
    host.execute(request)
        .await
        .expect("a valid export must be restorable through the host");
    let restored: serde_json::Value =
        serde_json::from_str(&host.database().unwrap().export().unwrap()).unwrap();
    assert_eq!(restored["articles"].as_array().unwrap().len(), 5000);
}

#[tokio::test]
#[ignore = "Requires the actual isolated Ollama model; no fixture response"]
async fn connect_actual_local_ai_persists_exact_model_without_enabling_cloud_or_sources() {
    let host = Backend::new(Database::memory().unwrap());
    let provider = host
        .execute(json!({"op":"local_ai_connect"}))
        .await
        .unwrap();
    assert_eq!(provider["model"], "qwen3:4b-instruct-2507-q4_K_M");
    assert_eq!(provider["enabled"], true);
    assert_eq!(provider["consented"], true);
    let snap = host.execute(json!({"op":"snapshot"})).await.unwrap();
    let providers = snap["providers"].as_array().unwrap();
    assert_eq!(
        providers.iter().find(|p| p["id"] == "ollama").unwrap()["model"],
        provider["model"]
    );
    assert!(providers
        .iter()
        .filter(|p| p["id"] != "ollama")
        .all(|p| p["enabled"] == false));
    assert!(snap["sources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["aiAllowed"] != true));
}
