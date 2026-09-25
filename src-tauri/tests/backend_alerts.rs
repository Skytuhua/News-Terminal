use news_terminal_lib::db::Database;
use serde_json::{json, Value};
fn setup(path: &std::path::Path) -> Database {
    let mut db = Database::open(path).unwrap();
    let s = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),1000).unwrap();
    db.ingest(s["id"].as_str().unwrap(), &json!({"articles":[{"title":"Science fixture","url":"https://example.org/a","excerpt":"text"}]}),1000).unwrap();
    db.request(&json!({"op":"profile_update","alertsEnabled":true}), 1000)
        .unwrap();
    db.request(&json!({"op":"watchlist_save","watchlist":{"name":"Science","keywords":["science"],"topics":[],"sources":[],"alerts":true}}),1000).unwrap();
    db
}
#[test]
fn failed_notification_releases_receipt_and_retries_successfully_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("alerts.db");
    let mut db = setup(&path);
    let mut attempts = 0;
    assert_eq!(
        db.deliver_alerts(1000, 600, |_| {
            attempts += 1;
            Err("OS unavailable".into())
        })
        .unwrap(),
        1
    );
    let backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    assert_eq!(
        backup["alerts"],
        json!([]),
        "failed delivery must not remain a success receipt"
    );
    drop(db);
    let mut db = Database::open(&path).unwrap();
    db.deliver_alerts(1001, 600, |_| {
        attempts += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(attempts, 1, "failed delivery must back off");
    db.deliver_alerts(1060, 600, |_| {
        attempts += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(attempts, 2, "failed OS delivery must retry");
    db.deliver_alerts(1120, 600, |_| {
        attempts += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(attempts, 2, "success must deduplicate");
    let backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    assert_eq!(backup["alerts"].as_array().unwrap().len(), 1);
}
#[test]
fn failed_notification_attempts_are_bounded_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bounded.db");
    drop(setup(&path));
    let mut attempts = 0;
    for now in [1000, 1060, 1120, 1180, 1240] {
        let mut db = Database::open(&path).unwrap();
        db.deliver_alerts(now, 600, |_| {
            attempts += 1;
            Err("OS unavailable".into())
        })
        .unwrap();
    }
    assert_eq!(
        attempts, 3,
        "exactly three bounded delivery attempts including first try"
    );
}
