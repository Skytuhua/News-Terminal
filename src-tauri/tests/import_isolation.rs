use news_terminal_lib::{db::Database, Backend};
use serde_json::{json, Value};

#[test]
fn replacement_rejects_delayed_restore_before_execution() {
    let mut db = Database::memory().unwrap();
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","topics":[],"region":"world","language":"en","kind":"reporting","termsUrl":"https://example.org/terms","storage":"excerpt"}), 1).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"notModified":false,"articles":[{"id":"h","title":"Hidden","url":"https://example.org/h","excerpt":"","publishedAt":1}]}), 1).unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), 1).unwrap();
    let aid = &snapshot["articles"][0]["id"];
    let token = &snapshot["replacementToken"];
    db.request(&json!({"op":"article_state","articleId":aid,"hidden":true,"saved":true,"read":true,"replacementToken":token}), 1).unwrap();
    let delayed = json!({"op":"article_state","profileId":"default","articleId":aid,"hidden":false,"replacementToken":token});
    db.import(&db.export().unwrap()).unwrap();
    let before = db.export().unwrap();
    assert!(
        db.request(&delayed, 2).is_err(),
        "delayed restore must not unhide an imported story"
    );
    assert_eq!(db.export().unwrap(), before);
    let fresh = db.request(&json!({"op":"snapshot"}), 2).unwrap();
    db.request(&json!({"op":"article_state","articleId":aid,"hidden":false,"replacementToken":fresh["replacementToken"]}), 2).unwrap();
    let restored = db.article("default", aid.as_str().unwrap()).unwrap();
    assert_eq!(restored["hidden"], false);
    assert_eq!(restored["saved"], true);
    assert_eq!(restored["read"], true);
}

#[test]
fn replacement_rejects_pre_import_workspace_even_with_same_ids_and_revision() {
    let mut db = Database::memory().unwrap();
    let old = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), 1)
        .unwrap();
    let mut backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    let workspace = backup["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "workspace" && d["id"] == "default")
        .unwrap();
    workspace["data"]["tabs"].as_array_mut().unwrap().push(
        json!({"id":"import-only","title":"Imported tab","topic":"","query":"","mode":"all"}),
    );
    db.import(&backup.to_string()).unwrap();
    let before = db.export().unwrap();
    let result = db.request(&json!({"op":"workspace_save","profileId":"default","workspace":old,"expectedRevision":old["revision"],"replacementToken":old["replacementToken"]}), 2);
    assert!(
        result.is_err(),
        "pre-import workspace must not overwrite the replacement"
    );
    assert_eq!(db.export().unwrap(), before);
    let fresh = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), 2)
        .unwrap();
    assert_ne!(old["replacementToken"], fresh["replacementToken"]);
    assert_eq!(fresh["revision"], old["revision"]);
    assert_eq!(fresh["tabs"].as_array().unwrap().len(), 2);
    db.request(&json!({"op":"workspace_save","profileId":"default","workspace":fresh,"expectedRevision":fresh["revision"],"replacementToken":fresh["replacementToken"]}), 3).unwrap();
    assert!(!db.export().unwrap().contains("replacementToken"));
}

#[test]
fn replacement_token_is_required_ephemeral_and_changes_only_on_committed_import() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("replacement.db");
    let mut db = Database::open(&path).unwrap();
    let old = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), 1)
        .unwrap();
    let backup = db.export().unwrap();
    for op in ["workspace_save", "article_state", "group_split"] {
        for token in [
            None,
            Some(Value::Null),
            Some(json!(0)),
            Some(json!("")),
            Some(json!("forged")),
        ] {
            let mut request = json!({"op":op,"profileId":"default","workspace":old,"expectedRevision":0,"articleId":"missing","hidden":false});
            if let Some(token) = token {
                request["replacementToken"] = token;
            }
            assert!(db
                .request(&request, 1)
                .unwrap_err()
                .starts_with("Database replaced:"));
        }
    }
    assert_eq!(db.export().unwrap(), backup);
    assert!(db.import("{}").is_err());
    db.request(&json!({"op":"profile_create","name":"Other"}), 1)
        .unwrap();
    let current = db.request(&json!({"op":"snapshot"}), 1).unwrap();
    assert_eq!(old["replacementToken"], current["replacementToken"]);
    assert!(!backup.contains(old["replacementToken"].as_str().unwrap()));
    let mut forged: Value = serde_json::from_str(&backup).unwrap();
    forged["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "workspace")
        .unwrap()["data"]["replacementToken"] = old["replacementToken"].clone();
    assert!(
        db.import(&forged.to_string()).is_err(),
        "backups cannot inject replacement identity"
    );
    db.import(&backup).unwrap();
    let imported = db.request(&json!({"op":"snapshot"}), 1).unwrap();
    assert_ne!(imported["replacementToken"], old["replacementToken"]);
    assert_eq!(db.export().unwrap(), backup);
    drop(db);
    let mut reopened = Database::open(&path).unwrap();
    assert_ne!(
        reopened.request(&json!({"op":"snapshot"}), 1).unwrap()["replacementToken"],
        imported["replacementToken"]
    );
}

#[tokio::test]
async fn host_barrier_rejects_dispatched_old_writes_after_import() {
    let mut db = Database::memory().unwrap();
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","topics":[],"region":"world","language":"en","kind":"reporting","termsUrl":"https://example.org/terms","storage":"excerpt"}), 1).unwrap();
    db.ingest(
        source["id"].as_str().unwrap(),
        &json!({"articles":[{"title":"Hidden","url":"https://example.org/h","excerpt":""}]}),
        1,
    )
    .unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), 1).unwrap();
    let token = &snapshot["replacementToken"];
    let aid = &snapshot["articles"][0]["id"];
    db.request(&json!({"op":"article_state","articleId":aid,"hidden":true,"saved":true,"replacementToken":token}), 1).unwrap();
    let requests = vec![
        json!({"op":"article_state","articleId":aid,"hidden":false,"replacementToken":token}),
        json!({"op":"workspace_save","workspace":snapshot["workspace"],"expectedRevision":0,"replacementToken":token}),
        json!({"op":"group_split","articleId":aid,"replacementToken":token}),
    ];
    let host = Backend::new(db);
    let backup = host.execute(json!({"op":"export"})).await.unwrap();
    let (release, held) = tokio::sync::oneshot::channel();
    let mut delayed = Box::pin(async {
        held.await.unwrap();
        for request in requests {
            assert!(host
                .execute(request)
                .await
                .unwrap_err()
                .starts_with("Database replaced:"));
        }
    });
    assert!(futures_util::poll!(&mut delayed).is_pending());
    host.execute(json!({"op":"import","data":backup}))
        .await
        .unwrap();
    release.send(()).unwrap();
    delayed.await;
    assert_eq!(host.execute(json!({"op":"export"})).await.unwrap(), backup);
}
