use news_terminal_lib::{db::Database, Backend};
use serde_json::json;
#[tokio::test]
async fn host_rejects_unpermitted_ai_without_sending_content() {
    let mut db = Database::memory().unwrap();
    let source=db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),1000).unwrap();
    db.ingest(source["id"].as_str().unwrap(),&json!({"articles":[{"id":"1","title":"Headline","url":"https://example.org/a","excerpt":"Private fixture"}]}),1000).unwrap();
    let a = db.request(&json!({"op":"snapshot"}), 1000).unwrap()["articles"][0].clone();
    let host = Backend::new(db);
    let error = host
        .execute(
            json!({"op":"summarize","profileId":"default","articleId":a["id"],"requestId":"req-1"}),
        )
        .await
        .unwrap_err();
    assert!(error.contains("permission"));
    assert_eq!(
        host.execute(json!({"op":"summary_cancel","requestId":"req-1"}))
            .await
            .unwrap(),
        serde_json::Value::Null
    );
}
#[tokio::test]
async fn host_rejects_metadata_only_ai_even_when_source_ai_flag_is_true() {
    let mut db = Database::memory().unwrap();
    let source = db.request(&json!({"op":"source_add","name":"Metadata fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"metadata","aiAllowed":true}),1000).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"id":"meta","title":"Metadata headline","url":"https://example.org/meta","excerpt":"Must not leave host"}]}),1000).unwrap();
    let a = db.request(&json!({"op":"snapshot"}), 1000).unwrap()["articles"][0].clone();
    let host = Backend::new(db);
    let error = host.execute(json!({"op":"summarize","profileId":"default","articleId":a["id"],"requestId":"metadata-reject"})).await.unwrap_err();
    assert!(error.contains("metadata-only"), "unexpected error: {error}");
}

#[tokio::test]
async fn empty_refresh_and_unknown_operations_return_honest_results() {
    let host = Backend::new(Database::memory().unwrap());
    assert_eq!(
        host.execute(json!({"op":"refresh"})).await.unwrap(),
        json!({"updated":0,"failed":0})
    );
    assert!(host.execute(json!({"op":"invented"})).await.is_err());
}
