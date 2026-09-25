use news_terminal_lib::db::Database;
use serde_json::{json, Value};
const NOW: i64 = 1_800_000_000;

#[test]
fn invalid_media_batch_is_atomic_and_safe_video_metadata_is_preserved() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db, Some(true), "excerpt");
    let sid = src["id"].as_str().unwrap();
    let mut good = feed();
    good["articles"][0]["media"].as_array_mut().unwrap().push(json!({"kind":"video","url":"https://example.org/clip.mp4","mimeType":"video/mp4","playback":"inline"}));
    db.ingest(sid, &good, NOW).unwrap();
    assert_eq!(first(&mut db)["media"], good["articles"][0]["media"]);
    let baseline = db.export().unwrap();
    for invalid in [
        Value::Null,
        json!(vec![media()[0].clone(); 9]),
        json!([{"kind":"image","url":"https://127.0.0.1/private.png","playback":"inline"}]),
    ] {
        let mut batch = good.clone();
        batch["articles"][0]["title"] = json!("A changed title that must not commit");
        let mut second = good["articles"][0].clone();
        second["url"] = json!("https://example.org/second");
        second["media"] = invalid;
        batch["articles"].as_array_mut().unwrap().push(second);
        assert!(db.ingest(sid, &batch, NOW + 1).is_err());
        assert_eq!(db.export().unwrap(), baseline);
    }
}

#[test]
fn custom_media_permission_can_be_revoked_without_changing_enablement_or_ai_rights() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db, None, "excerpt");
    let sid = src["id"].as_str().unwrap();
    db.request(
        &json!({"op":"source_update","sourceId":sid,"mediaAllowed":true}),
        NOW,
    )
    .unwrap();
    db.ingest(sid, &feed(), NOW).unwrap();
    let original = first(&mut db);
    assert_eq!(original["media"], media());
    guarded(
        &mut db,
        json!({"op":"article_state","articleId":original["id"],"saved":true}),
        NOW,
    )
    .unwrap();
    db.request(
        &json!({"op":"source_update","sourceId":sid,"mediaAllowed":false}),
        NOW,
    )
    .unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), NOW).unwrap();
    assert_eq!(snapshot["sources"][0]["enabled"], true);
    assert_eq!(snapshot["sources"][0]["aiAllowed"], false);
    assert_eq!(snapshot["sources"][0]["mediaAllowed"], false);
    assert!(snapshot["articles"][0].get("media").is_none());
    assert_eq!(snapshot["articles"][0]["saved"], true);
    assert_eq!(snapshot["articles"][0]["firstSeen"], original["firstSeen"]);
    db.ingest(sid, &feed(), NOW + 1).unwrap();
    assert!(first(&mut db).get("media").is_none());
    db.export().unwrap();
    db.request(
        &json!({"op":"source_update","sourceId":sid,"enabled":false}),
        NOW,
    )
    .unwrap();
    assert_eq!(
        db.request(&json!({"op":"snapshot"}), NOW).unwrap()["sources"][0]["enabled"],
        false
    );
}

#[test]
fn catalog_media_permission_cannot_be_elevated_by_source_update() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("catalog.db")).unwrap();
    let sources = db.list("source", "").unwrap();
    let source = sources.iter().find(|s| s["mediaAllowed"] != true).unwrap();
    assert!(db.request(&json!({"op":"source_update","sourceId":source["id"],"enabled":true,"mediaAllowed":true}), NOW).is_err());
    assert_eq!(db.list("source", "").unwrap(), sources);
    db.request(
        &json!({"op":"source_update","sourceId":source["id"],"enabled":false}),
        NOW,
    )
    .unwrap();
}

#[test]
fn backup_rejects_media_without_source_permission_atomically() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db, Some(true), "excerpt");
    db.ingest(src["id"].as_str().unwrap(), &feed(), NOW)
        .unwrap();
    let baseline = db.export().unwrap();
    for policy in ["missing", "denied", "metadata"] {
        let mut backup: Value = serde_json::from_str(&baseline).unwrap();
        let source = backup["documents"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| d["kind"] == "source")
            .unwrap();
        match policy {
            "missing" => {
                source["data"]
                    .as_object_mut()
                    .unwrap()
                    .remove("mediaAllowed");
            }
            "denied" => source["data"]["mediaAllowed"] = json!(false),
            _ => {
                source["data"]["storage"] = json!("metadata");
                backup["articles"][0]["excerpt"] = json!("");
            }
        }
        assert!(
            db.import(&backup.to_string()).is_err(),
            "accepted {policy} media"
        );
        assert_eq!(db.export().unwrap(), baseline);
    }
}

#[test]
fn backup_rejects_private_media_urls_and_invalid_extended_fields() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db, Some(true), "excerpt");
    db.ingest(src["id"].as_str().unwrap(), &feed(), NOW)
        .unwrap();
    let baseline = db.export().unwrap();
    for playback in ["inline", "external"] {
        for url in [
            "https://127.0.0.1/a.png",
            "https://localhost/a.png",
            "https://10.0.0.1/a.png",
            "https://[::1]/a.png",
            "file:///secret.png",
            "https://user:password@example.org/a.png",
        ] {
            let mut backup: Value = serde_json::from_str(&baseline).unwrap();
            backup["articles"][0]["media"][0]["url"] = json!(url);
            backup["articles"][0]["media"][0]["playback"] = json!(playback);
            assert!(
                db.import(&backup.to_string()).is_err(),
                "accepted {playback} {url}"
            );
            assert_eq!(db.export().unwrap(), baseline);
        }
    }
    for invalid in [
        Value::Null,
        json!({}),
        json!([{"kind":"audio","url":"https://example.org/audio.mp3","playback":"inline"}]),
        json!([{"kind":"image","url":"https://example.org/a.png","playback":"inline","secret":"no"}]),
        json!(vec![media()[0].clone(); 9]),
    ] {
        let mut backup: Value = serde_json::from_str(&baseline).unwrap();
        backup["articles"][0]["media"] = invalid;
        assert!(db.import(&backup.to_string()).is_err());
    }
    let mut backup: Value = serde_json::from_str(&baseline).unwrap();
    let source = backup["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "source")
        .unwrap();
    source["data"]["mediaAllowed"] = json!("true");
    assert!(db.import(&backup.to_string()).is_err());
}

#[test]
fn missing_permission_and_metadata_storage_drop_media_and_old_backups_still_restore() {
    for (permission, storage) in [
        (None, "excerpt"),
        (Some(false), "excerpt"),
        (Some(true), "metadata"),
    ] {
        let mut db = Database::memory().unwrap();
        let src = source(&mut db, permission, storage);
        if permission.is_none() {
            assert_eq!(src["mediaAllowed"], false);
        }
        db.ingest(src["id"].as_str().unwrap(), &feed(), NOW)
            .unwrap();
        let article = first(&mut db);
        assert!(article.get("media").is_none());
        assert_eq!(article["aiAllowed"], false);
        let mut old: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
        for d in old["documents"].as_array_mut().unwrap() {
            if d["kind"] == "source" {
                d["data"].as_object_mut().unwrap().remove("mediaAllowed");
            }
        }
        let old = old.to_string();
        db.import(&old).unwrap();
        assert_eq!(db.export().unwrap(), old);
    }
}

fn source(db: &mut Database, permission: Option<bool>, storage: &str) -> Value {
    let mut request = json!({"op":"source_add","name":"Media desk","url":"https://example.org/feed","topics":["science"],"region":"world","language":"en","kind":"reporting","termsUrl":"https://example.org/terms","storage":storage});
    if let Some(permission) = permission {
        request["mediaAllowed"] = json!(permission);
    }
    db.request(&request, NOW).unwrap()
}
fn media() -> Value {
    json!([{"kind":"image","url":"https://example.org/image.png","mimeType":"image/png","caption":"Telescope","credit":"Science desk","playback":"inline"}])
}
fn feed() -> Value {
    json!({"articles":[{"title":"Telescope images","url":"https://example.org/story","publishedAt":NOW,"excerpt":"Supplied lead","media":media()}]})
}
fn first(db: &mut Database) -> Value {
    db.request(&json!({"op":"snapshot"}), NOW).unwrap()["articles"][0].clone()
}

#[test]
fn permitted_media_roundtrips_with_saved_state_and_stable_revisions() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db, Some(true), "excerpt");
    assert_eq!(src["mediaAllowed"], true);
    let sid = src["id"].as_str().unwrap();
    assert_eq!(db.ingest(sid, &feed(), NOW).unwrap(), 1);
    let original = first(&mut db);
    assert_eq!(original["media"], media());
    guarded(
        &mut db,
        json!({"op":"article_state","articleId":original["id"],"saved":true}),
        NOW,
    )
    .unwrap();
    let mut changed = feed();
    changed["articles"][0]["media"][0]["caption"] = json!("Updated caption");
    assert_eq!(db.ingest(sid, &changed, NOW + 1).unwrap(), 1);
    assert_eq!(db.ingest(sid, &changed, NOW + 2).unwrap(), 0);
    let revised = first(&mut db);
    assert_eq!(revised["firstSeen"], original["firstSeen"]);
    assert_eq!(revised["saved"], true);
    assert_eq!(revised["media"], changed["articles"][0]["media"]);
    assert_eq!(db.retain(NOW + 31 * 86400).unwrap(), 0);
    assert_eq!(first(&mut db)["media"], revised["media"]);
    let backup = db.export().unwrap();
    let mut restored = Database::memory().unwrap();
    restored.import(&backup).unwrap();
    assert_eq!(first(&mut restored), revised);
    assert_eq!(restored.export().unwrap(), backup);
}

fn guarded(db: &mut Database, mut request: Value, now: i64) -> Result<Value, String> {
    request["replacementToken"] = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)?["replacementToken"]
        .clone();
    db.request(&request, now)
}
