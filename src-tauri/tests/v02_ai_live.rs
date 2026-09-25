//! Actual local model test with synthetic, public-domain test material, NOT live news.
use news_terminal_lib::{db::Database, Backend};
use serde_json::json;

#[tokio::test]
#[ignore = "Requires actual local Qwen model on loopback; no fixture server"]
async fn actual_local_model_summarizes_through_authorized_host_pipeline() {
    let mut db = Database::memory().unwrap();
    let now = chrono::Utc::now().timestamp();
    let source = db.request(&json!({"op":"source_add","name":"Synthetic public-domain AI test","url":"https://example.org/synthetic-test-feed","termsUrl":"https://example.org/test-material","topics":["culture"],"language":"en","region":"world","kind":"reporting","storage":"excerpt","aiAllowed":true}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Synthetic test: Pinebridge library opens","url":"https://example.org/synthetic-library","excerpt":"This is synthetic public-domain test material, not real news. Pinebridge opened a free public library on Monday with 1200 books. It opens Tuesday through Saturday. Volunteer reading classes start next month. No opening date for a second branch was announced.","publishedAt":now}]}),now).unwrap();
    let host = Backend::new(db);
    host.execute(json!({"op":"local_ai_connect"}))
        .await
        .unwrap();
    let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
    let article = &snapshot["articles"][0];
    let result = host.execute(json!({"op":"summarize","profileId":"default","articleId":article["id"],"requestId":"actual-v02-synthetic-test"})).await.unwrap();
    assert_eq!(result["provider"], "ollama");
    assert_eq!(result["model"], "qwen3:4b-instruct-2507-q4_K_M");
    assert_eq!(result["scope"], "feed excerpt");
    assert!(result["text"].as_str().unwrap().len() > 20);
    println!("ACTUAL_LOCAL_MODEL_SYNTHETIC_INPUT {}", result);
}
