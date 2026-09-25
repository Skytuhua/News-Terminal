use news_terminal_lib::db::Database;
use rusqlite::params;
use serde_json::json;

#[test]
fn reclassification_preserves_identity_and_reading_state() {
    reclassification_case(
        "OpenAI chip partner reports earnings",
        "AI accelerator revenue lifted shares.",
        json!(["ai", "technology", "stocks"]),
        false,
    );
}

#[test]
fn version_one_cached_space_engineering_is_backfilled_without_state_loss() {
    reclassification_case(
        "NASA Calls for Proposals to Accelerate Lunar Surface Technologies",
        "NASA seeks proposals for technology and infrastructure.",
        json!(["technology"]),
        true,
    );
}

fn reclassification_case(title: &str, excerpt: &str, sections: serde_json::Value, cached_v1: bool) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("focus-migration.db");
    let now = 1_800_000_000;
    let mut db = Database::open(&path).unwrap();
    let source = db
        .request(
            &json!({
                "op":"source_add",
                "name":"AI Business",
                "url":"https://example.org/feed",
                "termsUrl":"https://example.org/terms",
                "topics":["business","technology"],
                "language":"en",
                "region":"world",
                "kind":"reporting",
                "storage":"excerpt"
            }),
            now,
        )
        .unwrap();
    let article_id = "legacy-focus-row";
    let mut legacy = json!({
        "id":article_id,
        "sourceId":source["id"],
        "sourceName":source["name"],
        "title":title,
        "url":"https://example.org/story",
        "excerpt":excerpt,
        "classificationVersion":1,
        "sections":["others"],
        "topicLabels":[],
        "classificationReasons":["No focused-section evidence; kept under Others"],
        "publishedAt":now - 7200,
        "firstSeen":now - 3600,
        "updatedAt":now - 1800,
        "topics":source["topics"],
        "region":source["region"],
        "language":source["language"],
        "kind":source["kind"],
        "aiAllowed":false,
        "read":false,
        "saved":false,
        "hidden":false,
        "groupId":"legacy-group",
        "reasons":["legacy import"],
        "score":7,
        "history":[{"at":now - 2400,"title":"Older title","excerpt":"Older excerpt"}]
    });
    if !cached_v1 {
        for key in [
            "classificationVersion",
            "sections",
            "topicLabels",
            "classificationReasons",
        ] {
            legacy.as_object_mut().unwrap().remove(key);
        }
    }
    let state = json!({"read":true,"saved":true,"hidden":true,"groupId":"legacy-group"});
    drop(db);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO articles(id,source_id,data) VALUES(?1,?2,?3)",
        params![
            article_id,
            source["id"].as_str().unwrap(),
            legacy.to_string()
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO states(profile_id,article_id,data) VALUES('default',?1,?2)",
        params![article_id, state.to_string()],
    )
    .unwrap();
    drop(conn);

    let reopened = Database::open(&path).unwrap();
    let after = reopened.article("default", article_id).unwrap();
    assert_eq!(after["id"], article_id);
    assert_eq!(after["firstSeen"], legacy["firstSeen"]);
    assert_eq!(after["publishedAt"], legacy["publishedAt"]);
    assert_eq!(after["updatedAt"], legacy["updatedAt"]);
    assert_eq!(after["history"], legacy["history"]);
    assert_eq!(after["saved"], true);
    assert_eq!(after["read"], true);
    assert_eq!(after["hidden"], true);
    assert_eq!(after["sections"], sections);
    assert_eq!(after["classificationVersion"], json!(2));
    for (key, value) in legacy.as_object().unwrap() {
        if ![
            "classificationVersion",
            "sections",
            "topicLabels",
            "classificationReasons",
            "read",
            "saved",
            "hidden",
        ]
        .contains(&key.as_str())
        {
            assert_eq!(&after[key], value, "retained {key}");
        }
    }
    assert!(after.get("media").is_none());
    assert_eq!(after["aiAllowed"], false);

    drop(reopened);
    let reopened_again = Database::open(&path).unwrap();
    let twice = reopened_again.article("default", article_id).unwrap();
    assert_eq!(twice, after);

    // Import also reclassifies old cached sections; it does not mint media rights.
    let mut backup: serde_json::Value =
        serde_json::from_str(&reopened_again.export().unwrap()).unwrap();
    backup["articles"][0]["classificationVersion"] = json!(1);
    backup["articles"][0]["sections"] = json!(["others"]);
    let mut imported = Database::memory().unwrap();
    imported.import(&backup.to_string()).unwrap();
    let restored = imported.article("default", article_id).unwrap();
    assert_eq!(restored["sections"], sections);
    assert_eq!(restored["classificationVersion"], 2);
    for key in [
        "id",
        "sourceId",
        "url",
        "title",
        "excerpt",
        "firstSeen",
        "publishedAt",
        "updatedAt",
        "history",
        "groupId",
        "read",
        "saved",
        "hidden",
    ] {
        assert_eq!(restored[key], after[key], "import retained {key}");
    }
    assert!(restored.get("media").is_none());
    assert!(imported.authorize_ai(&restored).is_err());
}

#[test]
fn catalog_reopen_preserves_exportability_at_source_capacity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("capacity.db");
    let now = 1_800_000_000;
    let mut db = Database::open(&path).unwrap();
    let initial = db.list("source", "").unwrap().len();
    assert!(initial < news_terminal_lib::db::MAX_SOURCES);

    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute(
        "DELETE FROM documents WHERE kind='source' AND id='openai-news' AND scope=''",
        [],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM catalog_revisions WHERE source_id='openai-news'",
        [],
    )
    .unwrap();
    drop(conn);

    while db.list("source", "").unwrap().len() < news_terminal_lib::db::MAX_SOURCES {
        let index = db.list("source", "").unwrap().len();
        db.request(
            &json!({
                "op":"source_add",
                "name":format!("Custom Source {index}"),
                "url":format!("https://example-{index}.org/feed.xml"),
                "termsUrl":format!("https://example-{index}.org/terms"),
                "topics":["local-civic"],
                "language":"en",
                "region":"world",
                "kind":"reporting",
                "storage":"excerpt"
            }),
            now,
        )
        .unwrap();
    }
    assert_eq!(
        db.list("source", "").unwrap().len(),
        news_terminal_lib::db::MAX_SOURCES
    );

    drop(db);
    let reopened = Database::open(&path).unwrap();
    let sources = reopened.list("source", "").unwrap();
    assert_eq!(sources.len(), news_terminal_lib::db::MAX_SOURCES);
    assert!(sources.iter().all(|source| source["id"] != "openai-news"));
    assert!(reopened.export().unwrap().contains("\"version\":1"));
}

#[test]
fn imports_version_one_legacy_workspace_and_restrictive_custom_sources() {
    let now = 1_800_000_000;
    let mut source_db = Database::memory().unwrap();
    let restrictive = source_db
        .request(
            &json!({
                "op":"source_add",
                "name":"Restrictive Metadata Feed",
                "url":"https://restrictive.example.org/feed.xml",
                "termsUrl":"https://restrictive.example.org/terms",
                "topics":["local-civic"],
                "language":"en",
                "region":"world",
                "kind":"reporting",
                "storage":"metadata",
                "mediaAllowed":false,
                "aiAllowed":false
            }),
            now,
        )
        .unwrap();
    let mut backup: serde_json::Value = serde_json::from_str(&source_db.export().unwrap()).unwrap();
    let workspace = backup["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|doc| doc["kind"] == "workspace" && doc["id"] == "default")
        .unwrap();
    workspace["data"]["tabs"][0]
        .as_object_mut()
        .unwrap()
        .remove("section");
    workspace["data"]["tabs"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"topic-only",
            "title":"Local Civic",
            "topic":"local-civic",
            "query":"",
            "mode":"all"
        }));

    let mut target = Database::memory().unwrap();
    target.import(&backup.to_string()).unwrap();
    let snapshot = target.request(&json!({"op":"snapshot"}), now).unwrap();
    let tabs = snapshot["workspace"]["tabs"].as_array().unwrap();
    assert!(tabs[0].get("section").is_none());
    assert_eq!(tabs[1]["topic"], "local-civic");
    assert!(tabs[1].get("section").is_none());
    let restored = snapshot["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["id"] == restrictive["id"])
        .unwrap();
    assert_eq!(restored["storage"], "metadata");
    assert_eq!(restored["aiAllowed"], false);
    assert_eq!(restored["mediaAllowed"], false);
}

#[test]
fn future_version_import_is_atomic() {
    let now = 1_800_000_000;
    let mut db = Database::memory().unwrap();
    let before = db.request(&json!({"op":"snapshot"}), now).unwrap();
    let mut backup: serde_json::Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    backup["version"] = json!(999);

    let err = db.import(&backup.to_string()).unwrap_err();
    assert!(err.contains("Unsupported backup version"));
    let after = db.request(&json!({"op":"snapshot"}), now).unwrap();
    assert_eq!(after["workspace"], before["workspace"]);
    assert_eq!(after["sources"], before["sources"]);
    assert_eq!(after["articles"], before["articles"]);
}

#[test]
fn constructed_default_workspace_is_ai_focused() {
    let mut db = Database::memory().unwrap();
    let workspace = db
        .request(
            &json!({"op":"workspace_get","profileId":"default"}),
            1_800_000_000,
        )
        .unwrap();
    assert_eq!(workspace["tabs"][0]["title"], "AI");
    assert_eq!(workspace["tabs"][0]["section"], "ai");
    assert_eq!(workspace["activeTabId"], "home");
}

#[test]
fn custom_sources_record_free_only_directory_metadata() {
    let mut db = Database::memory().unwrap();
    let source = db
        .request(
            &json!({
                "op":"source_add",
                "name":"Custom Free Feed",
                "url":"https://example.org/feed.xml",
                "termsUrl":"https://example.org/terms",
                "topics":["technology"],
                "language":"en",
                "region":"world",
                "kind":"reporting",
                "storage":"excerpt"
            }),
            1_800_000_000,
        )
        .unwrap();
    assert_eq!(source["accessMode"], "approval-free");
    assert_eq!(source["sourceAdapter"], "feed");
    assert_eq!(source["publisher"], "Custom Free Feed");
    assert_eq!(source["imagesAvailable"], false);
    assert_eq!(source["mediaAllowed"], false);
}
