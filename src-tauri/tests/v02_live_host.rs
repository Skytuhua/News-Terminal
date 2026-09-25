use news_terminal_lib::{db::Database, Backend};
use serde_json::json;

#[tokio::test]
async fn live_host_starts_off_rejects_invalid_toggle_and_shares_status() {
    let host = Backend::new(Database::memory().unwrap());
    let status = host.execute(json!({"op":"live_status"})).await.unwrap();
    assert_eq!(status["enabled"], false);
    assert_eq!(status["state"], "off");
    assert!(host
        .execute(json!({"op":"live_set","enabled":"true"}))
        .await
        .is_err());
    let off = host
        .execute(json!({"op":"live_set","enabled":false}))
        .await
        .unwrap();
    assert_eq!(off["enabled"], false);
    assert_eq!(
        host.execute(json!({"op":"live_status"})).await.unwrap()["items"],
        json!([])
    );
}
