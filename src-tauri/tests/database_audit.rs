use news_terminal_lib::db::Database;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

#[test]
fn one_host_owns_each_database_until_it_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("owned.db");
    let owner = Database::open(&path).unwrap();
    assert!(
        Database::open(&path).is_err(),
        "a second host must fail closed"
    );
    Database::open(dir.path().join("other.db")).unwrap();
    Database::memory().unwrap();
    drop(owner);
    Database::open(&path).unwrap();
}

#[test]
fn saved_limit_counts_unique_articles_across_profiles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("saved.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let other = db
        .request(&json!({"op":"profile_create","name":"Other"}), now)
        .unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO articles SELECT 'saved-'||i,?1,json_set(?2,'$.id','saved-'||i,'$.url','https://example.org/'||i) FROM n", params![source["id"].as_str(), article.to_string()]).unwrap();
    conn.execute("INSERT INTO states SELECT 'default',id,'{\"read\":false,\"saved\":true,\"hidden\":false}' FROM articles WHERE id LIKE 'saved-%'", []).unwrap();
    let token = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)
        .unwrap()["replacementToken"]
        .clone();
    db.request(&json!({"op":"article_state","profileId":other["id"],"articleId":"saved-0","saved":true,"replacementToken":token}), now).unwrap();
    assert_eq!(
        db.article(other["id"].as_str().unwrap(), "saved-0")
            .unwrap()["saved"],
        true
    );
    for op in ["article_state", "article_state_many"] {
        let request = if op == "article_state" {
            json!({"op":op,"profileId":other["id"],"articleId":article["id"],"saved":true,"replacementToken":token})
        } else {
            json!({"op":op,"profileId":other["id"],"items":[{"articleId":article["id"],"saved":true}],"replacementToken":token})
        };
        assert!(db.request(&request, now).unwrap_err().contains("10,000"));
    }
    assert_eq!(
        conn.query_row(
            "SELECT count(DISTINCT article_id) FROM states WHERE json_extract(data,'$.saved')=1",
            [],
            |r| r.get::<_, usize>(0)
        )
        .unwrap(),
        10_000
    );
}

#[test]
fn reopening_a_current_catalog_does_not_update_articles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("migration.db");
    let mut db = Database::open(&path).unwrap();
    let metadata = db
        .list("source", "")
        .unwrap()
        .into_iter()
        .find(|s| s["storage"] == "metadata")
        .unwrap();
    db.ingest(metadata["id"].as_str().unwrap(), &json!({"articles":[{"title":"Catalog fixture","url":"https://example.org/catalog","excerpt":""}]}), 1_800_000_000).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE article_changes(n INTEGER NOT NULL); INSERT INTO article_changes VALUES(0); CREATE TRIGGER count_article_changes AFTER UPDATE ON articles BEGIN UPDATE article_changes SET n=n+1; END;").unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let changes: usize = conn
        .query_row("SELECT n FROM article_changes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        changes, 0,
        "current metadata/media policies must not rewrite rows or FTS"
    );
    let backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    assert_eq!(backup["articles"].as_array().unwrap().len(), 1);
}
