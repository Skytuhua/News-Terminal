use news_terminal_lib::db::Database;
use serde_json::json;

#[test]
fn native_workspace_ownership_is_profile_and_tab_scoped() {
    let mut db = Database::memory().unwrap();
    assert!(db.workspace_owner_exists("default", None).unwrap());
    assert!(db.workspace_owner_exists("default", Some("home")).unwrap());
    assert!(!db
        .workspace_owner_exists("default", Some("missing"))
        .unwrap());
    assert!(!db.workspace_owner_exists("missing", None).unwrap());
    assert!(!db.workspace_owner_exists("missing", Some("home")).unwrap());
    let backup = db.export().unwrap();
    let p = db
        .request(&json!({"op":"profile_create","name":"Other"}), 1000)
        .unwrap();
    assert!(db
        .workspace_owner_exists(p["id"].as_str().unwrap(), Some("home"))
        .unwrap());
    db.import(&backup).unwrap();
    assert!(!db
        .workspace_owner_exists(p["id"].as_str().unwrap(), Some("home"))
        .unwrap());
}
