use news_terminal_lib::db::{Database, MAX_ARTICLE_STATE_BATCH};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

#[test]
fn hidden_stories_cover_retained_overflow_without_preferences_or_state_leakage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hidden-limits.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Excluded hidden fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let other = db
        .request(&json!({"op":"profile_create","name":"Other"}), now)
        .unwrap();
    let conn = Connection::open(&path).unwrap();
    // All 5,002 are hidden here, but saves belong only to the other profile.
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<5001) INSERT INTO articles SELECT printf('hidden-%04d',i),?1,json_set(?2,'$.id',printf('hidden-%04d',i),'$.url','https://example.org/'||i,'$.firstSeen',?3-i/2) FROM n", params![source["id"].as_str(), article.to_string(), now-1]).unwrap();
    conn.execute(r#"INSERT INTO states SELECT 'default',id,'{"hidden":true,"saved":false,"read":false,"groupId":"local-group"}' FROM articles WHERE id LIKE 'hidden-%'"#, []).unwrap();
    conn.execute(r#"INSERT INTO states SELECT ?1,id,'{"hidden":false,"saved":true,"read":true,"groupId":"other-group"}' FROM articles WHERE id LIKE 'hidden-%'"#, [other["id"].as_str().unwrap()]).unwrap();
    let request = json!({"op":"hidden_stories","profileId":"default"});
    let hidden = db.request(&request, now).unwrap();
    let expected: Vec<_> = (0..5002).map(|i| format!("hidden-{i:04}")).collect();
    assert_eq!(
        hidden
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        expected
    );
    assert!(hidden
        .as_array()
        .unwrap()
        .iter()
        .all(|a| a["hidden"] == true
            && a["saved"] == false
            && a["read"] == false
            && a["groupId"] == "local-group"));
    let snapshot = db.request(&json!({"op":"snapshot"}), now).unwrap();
    assert_eq!(snapshot["articles"].as_array().unwrap().len(), 5000);
    assert!(!snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["id"] == "hidden-5001"));
    db.request(
        &json!({"op":"profile_update","preferences":{"excludeKeywords":["Excluded"]}}),
        now,
    )
    .unwrap();
    assert_eq!(
        db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"],
        json!([])
    );
    assert_eq!(db.request(&request, now).unwrap(), hidden);
    assert_eq!(
        db.request(&json!({"op":"hidden_stories","profileId":other["id"]}), now)
            .unwrap(),
        json!([])
    );
    db.retain(now).unwrap();
    assert_eq!(
        db.request(&request, now).unwrap(),
        hidden,
        "other-profile saves protect old hidden articles"
    );
    guarded(&mut db, json!({"op":"article_state","profileId":other["id"],"articleId":"hidden-5001","saved":false}), now).unwrap();
    assert_eq!(
        db.retain(now).unwrap(),
        1,
        "hidden alone must not prevent size pruning"
    );
    let retained = db.request(&request, now).unwrap();
    assert_eq!(
        retained.as_array().unwrap(),
        &hidden.as_array().unwrap()[..5001]
    );
    assert_eq!(
        db.retain(now + 31 * 86400).unwrap(),
        1,
        "only the unsaved seed expires"
    );
    assert_eq!(db.request(&request, now).unwrap(), retained);
    guarded(&mut db, json!({"op":"article_state","profileId":other["id"],"articleId":"hidden-0000","saved":false}), now).unwrap();
    assert_eq!(
        db.retain(now + 31 * 86400).unwrap(),
        1,
        "hidden alone must not prevent age pruning"
    );
    let remaining = db.request(&request, now).unwrap();
    assert_eq!(
        remaining.as_array().unwrap(),
        &hidden.as_array().unwrap()[1..5001]
    );
    drop(conn);
    drop(db);
    let mut reopened = Database::open(&path).unwrap();
    assert_eq!(reopened.request(&request, now).unwrap(), remaining);
}

#[test]
fn workspace_get_uses_default_fallback_without_reading_articles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace-only.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "DELETE FROM documents WHERE kind='workspace' AND id='default'",
        [],
    )
    .unwrap();
    let mut expected = db
        .request(&json!({"op":"snapshot","profileId":"default"}), now)
        .unwrap()["workspace"]
        .clone();
    expected["replacementToken"] = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)
        .unwrap()["replacementToken"]
        .clone();
    // Make an article read impossible in this disposable fixture: the narrow
    // getter must not route through snapshot, article hydration, or ranking.
    conn.execute_batch("DROP TABLE articles").unwrap();
    assert!(db
        .request(&json!({"op":"snapshot","profileId":"default"}), now)
        .is_err());
    for _ in 0..2 {
        assert_eq!(
            db.request(&json!({"op":"workspace_get","profileId":"default"}), now)
                .unwrap(),
            expected
        );
    }
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM documents WHERE kind='workspace' AND id='default'",
            [],
            |r| r.get::<_, usize>(0)
        )
        .unwrap(),
        0,
        "fallback read must not create a workspace document"
    );
}

#[test]
fn export_enforces_import_state_and_receipt_limits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("limits.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    for i in 0..9 {
        db.request(
            &json!({"op":"profile_create","name":format!("Profile {i}")}),
            now,
        )
        .unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    // A real, valid runtime database: ten profiles, 5,001 articles, 50,000 states.
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<4999) INSERT INTO articles SELECT 'fixture-'||i,?1,json_set(?2,'$.id','fixture-'||i,'$.url','https://example.org/'||i) FROM n", params![source["id"].as_str(),article.to_string()]).unwrap();
    conn.execute("INSERT INTO states SELECT d.id,a.id,'{\"read\":true,\"saved\":false,\"hidden\":false}' FROM documents d CROSS JOIN articles a WHERE d.kind='profile' AND a.id LIKE 'fixture-%'", []).unwrap();
    let backup = db.export().unwrap();
    let parsed: Value = serde_json::from_str(&backup).unwrap();
    assert_eq!(parsed["states"].as_array().unwrap().len(), 50_000);
    Database::memory().unwrap().import(&backup).unwrap();
    conn.execute("INSERT INTO states VALUES('default',?1,'{\"read\":true,\"saved\":false,\"hidden\":false}')",[article["id"].as_str().unwrap()]).unwrap();
    assert!(db
        .export()
        .map(|_| ())
        .expect_err("over-limit states must reject export")
        .contains("states"));
    conn.execute(
        "DELETE FROM states WHERE article_id=?1",
        [article["id"].as_str().unwrap()],
    )
    .unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO alert_log SELECT 'default','receipt-'||i,?1 FROM n",[now]).unwrap();
    let backup = db.export().unwrap();
    Database::memory().unwrap().import(&backup).unwrap();
    conn.execute(
        "INSERT INTO alert_log VALUES('default','receipt-overflow',?1)",
        [now],
    )
    .unwrap();
    assert!(db
        .export()
        .map(|_| ())
        .expect_err("over-limit receipts must reject export")
        .contains("alerts"));
}

#[test]
fn article_state_many_is_bounded_and_never_partially_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("batch-limits.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"notModified":false,"etag":"v1","articles":[{"id":"one","title":"Fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let aid = article["id"].as_str().unwrap().to_owned();
    let conn = Connection::open(&path).unwrap();
    // A realistic mounted page plus headroom, so the bound is tested at a size
    // the renderer can actually produce, not at a synthetic token count.
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<299) INSERT INTO articles SELECT printf('bulk-%04d',i),?1,json_set(?2,'$.id',printf('bulk-%04d',i),'$.url','https://example.org/bulk-'||i) FROM n", params![source["id"].as_str(), article.to_string()]).unwrap();
    // Read the generated ids back over the same file: article ids are derived
    // from the canonical URL, so the batch must use the stored ids, not the
    // fixture labels.
    let mut ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM articles WHERE id LIKE 'bulk-%' ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        rows
    };
    drop(conn);
    ids.push(aid.clone());
    assert!(
        ids.len() > MAX_ARTICLE_STATE_BATCH,
        "fixture must exceed the bound"
    );
    let items = |n: usize, key: &str| -> Value {
        let mut v = json!({"articleId":ids[0],"saved":true});
        v[key] = json!(true);
        Value::Array(
            (0..n)
                .map(|i| {
                    let mut item = v.clone();
                    item["articleId"] = json!(ids[i % ids.len()]);
                    item
                })
                .collect(),
        )
    };
    let at_bound = MAX_ARTICLE_STATE_BATCH;
    guarded(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":items(at_bound,"read")}),
        now,
    )
    .unwrap();
    assert_eq!(
        db.request(&json!({"op":"hidden_stories","profileId":"default"}), now)
            .unwrap(),
        json!([])
    );
    let after_bound = db.export().unwrap();
    // One item past the bound is rejected, and the rejected batch writes nothing.
    for extra in [1usize, 2, 50] {
        let over = at_bound + extra;
        let error = guarded(
            &mut db,
            json!({"op":"article_state_many","profileId":"default","items":items(over,"read")}),
            now,
        )
        .unwrap_err();
        assert!(error.contains("Batch"), "unexpected error: {error}");
        assert_eq!(
            db.export().unwrap(),
            after_bound,
            "an over-bound batch must not write any of its {over} items"
        );
    }
    // An empty batch is a client bug, not a silent no-op success.
    assert!(guarded(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[]}),
        now
    )
    .is_err());
    // A non-array items field is rejected before any write.
    for bad in [json!(null), json!({}), json!("read"), json!(3)] {
        assert!(guarded(
            &mut db,
            json!({"op":"article_state_many","profileId":"default","items":bad}),
            now
        )
        .is_err());
    }
    assert_eq!(db.export().unwrap(), after_bound);
    // A per-item bad shape rejects the whole batch: a non-object item and a
    // missing articleId must not slip through the shared write path.
    for bad_item in [json!("read"), json!(3), json!({}), json!({"saved":true})] {
        assert_eq!(
            guarded(
                &mut db,
                json!({"op":"article_state_many","profileId":"default","items":[{"articleId":aid,"read":true},bad_item]}),
                now
            )
            .unwrap_err(),
            "Missing or invalid articleId",
            "accepted {bad_item}"
        );
    }
    assert_eq!(db.export().unwrap(), after_bound);
    // An unknown key inside an item is ignored exactly as the single path
    // ignores unknown request keys: the batch must not invent stricter rules
    // than the operation it is meant to replicate.
    guarded(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[{"articleId":aid,"starred":true,"read":true}]}),
        now,
    )
    .unwrap();
    let starred = db.article("default", aid.as_str()).unwrap();
    assert_eq!(starred["read"], json!(true));
    assert!(
        starred.get("starred").is_none(),
        "unknown keys must not be stored"
    );
}

fn guarded(db: &mut Database, mut request: Value, now: i64) -> Result<Value, String> {
    request["replacementToken"] = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)?["replacementToken"]
        .clone();
    db.request(&request, now)
}
