use news_terminal_lib::db::Database;
use serde_json::{json, Value};
fn source(db: &mut Database) -> Value {
    call(
        db,
        json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","topics":["science"],"region":"world","language":"en","kind":"reporting","termsUrl":"https://example.org/terms","storage":"excerpt"}),
    )
}
fn feed(title: &str) -> Value {
    json!({"notModified":false,"etag":"v1","articles":[{"id":"one","title":title,"url":"https://example.org/story?utm_source=rss&item=1","excerpt":"Permitted science excerpt","publishedAt":1_799_999_000}]})
}
#[test]
fn hidden_stories_persist_and_are_profile_scoped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hidden.db");
    let mut db = Database::open(&path).unwrap();
    let src = source(&mut db);
    db.ingest(
        src["id"].as_str().unwrap(),
        &feed("Hidden science"),
        1_800_000_000,
    )
    .unwrap();
    let article = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    let other = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    call(
        &mut db,
        json!({"op":"article_state","profileId":"default","articleId":article["id"],"hidden":true,"saved":true,"read":true}),
    );
    call(
        &mut db,
        json!({"op":"group_split","articleId":article["id"]}),
    );
    let expected = db
        .article("default", article["id"].as_str().unwrap())
        .unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    let before = db.export().unwrap();
    for _ in 0..2 {
        assert_eq!(
            call(
                &mut db,
                json!({"op":"hidden_stories","profileId":"default"})
            ),
            json!([expected])
        );
        assert_eq!(
            call(
                &mut db,
                json!({"op":"hidden_stories","profileId":other["id"]})
            ),
            json!([])
        );
    }
    assert_eq!(
        db.export().unwrap(),
        before,
        "reads must not mutate durable state"
    );
    call(
        &mut db,
        json!({"op":"article_state","profileId":"default","articleId":article["id"],"hidden":false}),
    );
    assert_eq!(
        call(
            &mut db,
            json!({"op":"hidden_stories","profileId":"default"})
        ),
        json!([])
    );
    let mut restored = expected;
    restored["hidden"] = json!(false);
    assert_eq!(
        db.article("default", article["id"].as_str().unwrap())
            .unwrap(),
        restored
    );
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(
        call(
            &mut db,
            json!({"op":"hidden_stories","profileId":"default"})
        ),
        json!([])
    );
    assert_eq!(
        db.article("default", article["id"].as_str().unwrap())
            .unwrap(),
        restored
    );
}

#[test]
fn hidden_stories_requires_an_explicit_valid_profile() {
    let mut db = Database::memory().unwrap();
    let before = db.export().unwrap();
    assert!(db.request(&json!({"op":"hidden_stories"}), 1).is_err());
    for id in [
        Value::Null,
        json!(false),
        json!(1),
        json!(""),
        json!("missing"),
        json!("x".repeat(201)),
    ] {
        assert!(
            db.request(&json!({"op":"hidden_stories","profileId":id}), 1)
                .is_err(),
            "accepted {id}"
        );
    }
    assert_eq!(db.export().unwrap(), before);
}

#[test]
fn feed_ingestion_persists_revisions_search_and_profile_states() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("news.db");
    let mut db = Database::open(&path).unwrap();
    let src = source(&mut db);
    let sid = src["id"].as_str().unwrap();
    assert_eq!(
        db.ingest(sid, &feed("Science discovery"), 1_800_000_000)
            .unwrap(),
        1
    );
    let s = call(&mut db, json!({"op":"snapshot"}));
    let aid = s["articles"][0]["id"].as_str().unwrap();
    assert_eq!(s["articles"][0]["firstSeen"], 1_800_000_000);
    call(
        &mut db,
        json!({"op":"article_state","articleId":aid,"saved":true,"read":true}),
    );
    assert_eq!(
        db.ingest(sid, &feed("Science discovery corrected"), 1_800_000_500)
            .unwrap(),
        1
    );
    assert_eq!(
        db.ingest(sid, &feed("Science discovery corrected"), 1_800_000_600)
            .unwrap(),
        0
    );
    let hits = call(&mut db, json!({"op":"search","query":"corrected"}));
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["history"].as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["history"][0]["title"], "Science discovery");
    assert_eq!(hits[0]["saved"], true);
    assert_eq!(hits[0]["url"], "https://example.org/story?item=1");
    let p = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    assert_eq!(
        call(&mut db, json!({"op":"snapshot","profileId":p["id"]}))["articles"][0]["saved"],
        false
    );
    call(&mut db, json!({"op":"profile_reset"}));
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["articles"][0]["saved"],
        true
    );
    assert!(request(
        &mut db,
        json!({"op":"article_state","articleId":"missing","saved":true}),
        1
    )
    .is_err());
}
#[test]
fn workspace_get_matches_snapshot_across_cas_reopen_and_import() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.db");
    let mut db = Database::open(&path).unwrap();
    let other = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    let initial = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    let read = json!({"op":"workspace_get","profileId":"default"});
    let before = db.export().unwrap();
    for _ in 0..2 {
        assert_eq!(durable_workspace(call(&mut db, read.clone())), initial);
    }
    assert_eq!(db.export().unwrap(), before);
    let mut updated = initial.clone();
    updated["tabs"][0]["title"] = json!("Edited in first window");
    call(
        &mut db,
        json!({"op":"workspace_save","workspace":updated,"expectedRevision":initial["revision"]}),
    );
    assert!(request(
        &mut db,
        json!({"op":"workspace_save","workspace":initial,"expectedRevision":initial["revision"]}),
        1
    )
    .unwrap_err()
    .contains("conflict"));
    let current = durable_workspace(call(&mut db, read.clone()));
    assert_eq!(
        current,
        call(&mut db, json!({"op":"snapshot"}))["workspace"]
    );
    assert_eq!(current["revision"], 1);
    call(
        &mut db,
        json!({"op":"workspace_save","workspace":current,"expectedRevision":current["revision"]}),
    );
    assert_eq!(
        durable_workspace(call(
            &mut db,
            json!({"op":"workspace_get","profileId":other["id"]})
        )),
        initial
    );
    let expected = durable_workspace(call(&mut db, read.clone()));
    assert_eq!(expected["revision"], 2);
    let backup = db.export().unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(durable_workspace(call(&mut db, read.clone())), expected);
    let mut imported = Database::memory().unwrap();
    imported.import(&backup).unwrap();
    assert_eq!(durable_workspace(call(&mut imported, read)), expected);
    assert_eq!(
        call(&mut imported, json!({"op":"snapshot"}))["workspace"],
        expected
    );
}

#[test]
fn workspace_get_requires_an_explicit_valid_profile() {
    let mut db = Database::memory().unwrap();
    let before = db.export().unwrap();
    assert!(db.request(&json!({"op":"workspace_get"}), 1).is_err());
    for id in [
        Value::Null,
        json!(false),
        json!(1),
        json!(""),
        json!("missing"),
        json!("x".repeat(201)),
    ] {
        assert!(
            db.request(&json!({"op":"workspace_get","profileId":id}), 1)
                .is_err(),
            "accepted {id}"
        );
    }
    assert_eq!(db.export().unwrap(), before);
}

#[test]
fn hidden_workspace_mode_persists_and_roundtrips_with_legacy_modes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hidden-workspace.db");
    let mut db = Database::open(&path).unwrap();
    let old_backup = db.export().unwrap();
    let modes = [
        "hidden",
        "all",
        "saved",
        "brief",
        "watchlist",
        "briefing",
        "live",
    ];
    let tabs: Vec<_> = modes.iter().map(|mode| json!({"id":mode,"title":mode,"mode":mode,"topic":"","query":"","selectedId":null,"watchlistId":null})).collect();
    call(
        &mut db,
        json!({"op":"workspace_save","profileId":"default","workspace":{"tabs":tabs,"activeTabId":"hidden"},"expectedRevision":0}),
    );
    let expected = durable_workspace(call(
        &mut db,
        json!({"op":"workspace_get","profileId":"default"}),
    ));
    let backup = db.export().unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(
        durable_workspace(call(
            &mut db,
            json!({"op":"workspace_get","profileId":"default"})
        )),
        expected
    );
    let mut imported = Database::memory().unwrap();
    imported.import(&backup).unwrap();
    assert_eq!(
        call(&mut imported, json!({"op":"snapshot"}))["workspace"],
        expected
    );
    imported.import(&old_backup).unwrap();
    assert_eq!(
        durable_workspace(call(
            &mut imported,
            json!({"op":"workspace_get","profileId":"default"})
        ))["tabs"][0]["mode"],
        "all"
    );
    let mut bad = expected;
    bad["tabs"][0]["mode"] = json!("unknown-mode");
    assert!(
        request(&mut db, json!({"op":"workspace_save","workspace":bad}), 1)
            .unwrap_err()
            .contains("tab mode")
    );
}

#[test]
fn workspace_rejects_stale_writes_and_watchlists_are_profile_scoped() {
    let mut db = Database::memory().unwrap();
    let p = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    let w = call(
        &mut db,
        json!({"op":"watchlist_save","watchlist":{"name":"Lab","keywords":["discovery"],"topics":[],"sources":[],"alerts":true}}),
    );
    assert_eq!(
        call(&mut db, json!({"op":"snapshot","profileId":p["id"]}))["watchlists"],
        json!([])
    );
    let mut ws = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    ws["tabs"][0]["title"] = json!("New title");
    call(
        &mut db,
        json!({"op":"workspace_save","workspace":ws,"expectedRevision":0}),
    );
    assert!(request(
        &mut db,
        json!({"op":"workspace_save","workspace":ws,"expectedRevision":0}),
        1
    )
    .unwrap_err()
    .contains("conflict"));
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["workspace"]["revision"],
        1
    );
    ws["activeTabId"] = json!("missing");
    assert!(request(&mut db, json!({"op":"workspace_save","workspace":ws}), 1).is_err());
    call(&mut db, json!({"op":"watchlist_delete","id":w["id"]}));
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["watchlists"],
        json!([])
    );
}
#[test]
fn recommendations_explain_diversity_and_related_groups_can_split() {
    let mut db = Database::memory().unwrap();
    let s1 = source(&mut db);
    let s2 = source(&mut db);
    let mut f = feed("European Space Agency launches science telescope");
    db.ingest(s1["id"].as_str().unwrap(), &f, 1_800_000_000)
        .unwrap();
    f["articles"][0]["url"] = json!("https://other.example.org/report");
    db.ingest(s2["id"].as_str().unwrap(), &f, 1_800_000_000)
        .unwrap();
    f["articles"][0]["url"] = json!("https://example.org/second");
    f["articles"][0]["title"] = json!("Science laboratory publishes unrelated findings");
    db.ingest(s1["id"].as_str().unwrap(), &f, 1_800_000_000)
        .unwrap();
    call(
        &mut db,
        json!({"op":"profile_update","preferences":{"topics":["science"],"diversityCap":0.5}}),
    );
    let a = call(&mut db, json!({"op":"snapshot"}))["articles"]
        .as_array()
        .unwrap()
        .clone();
    assert!(a.iter().all(|a| a["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r.as_str().unwrap().contains("science"))));
    assert_ne!(a[0]["sourceId"], a[1]["sourceId"]);
    let same: Vec<_> = a
        .iter()
        .filter(|a| a["title"] == "European Space Agency launches science telescope")
        .collect();
    assert_eq!(same[0]["groupId"], same[1]["groupId"]);
    call(
        &mut db,
        json!({"op":"group_split","articleId":same[0]["id"]}),
    );
    let after = call(&mut db, json!({"op":"snapshot"}));
    let split = after["articles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == same[0]["id"])
        .unwrap();
    assert_ne!(split["groupId"], same[1]["groupId"]);
    call(
        &mut db,
        json!({"op":"profile_update","preferences":{"excludeKeywords":["unrelated"]}}),
    );
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["articles"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn alerts_respect_overnight_quiet_hours_deduplicate_and_rate_limit() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    call(
        &mut db,
        json!({"op":"profile_update","alertsEnabled":true,"quietHours":{"enabled":true,"start":"22:00","end":"08:00"}}),
    );
    call(
        &mut db,
        json!({"op":"watchlist_save","watchlist":{"name":"Lab","keywords":["science"],"topics":[],"sources":[],"alerts":true}}),
    );
    let mut f = feed("Science discovery");
    let mut items = vec![];
    for i in 0..5 {
        let mut a = f["articles"][0].clone();
        a["url"] = json!(format!("https://example.org/{i}"));
        items.push(a);
    }
    f["articles"] = json!(items);
    db.ingest(src["id"].as_str().unwrap(), &f, 1000).unwrap();
    assert!(db.alerts(1000, 23 * 60).unwrap().is_empty());
    assert!(db.alerts(1000, 7 * 60).unwrap().is_empty());
    let first = db.alerts(1000, 8 * 60).unwrap();
    assert_eq!(first.len(), 3);
    assert!(db.alerts(1001, 8 * 60).unwrap().is_empty());
    assert!(db.alerts(1700, 8 * 60).unwrap().is_empty());
    let p = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    call(
        &mut db,
        json!({"op":"profile_update","profileId":p["id"],"alertsEnabled":true}),
    );
    call(
        &mut db,
        json!({"op":"watchlist_save","profileId":p["id"],"watchlist":{"name":"Lab","keywords":["science"],"topics":[],"sources":[],"alerts":true}}),
    );
    assert_eq!(db.alerts(1001, 8 * 60).unwrap().len(), 3);
}
#[test]
fn backup_import_is_atomic_validated_secret_free_and_retention_preserves_saves() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(
        src["id"].as_str().unwrap(),
        &feed("Science discovery"),
        1000,
    )
    .unwrap();
    let a = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    call(
        &mut db,
        json!({"op":"article_state","articleId":a["id"],"saved":true}),
    );
    let backup = call(&mut db, json!({"op":"export"}))
        .as_str()
        .unwrap()
        .to_owned();
    assert!(!backup.contains("apiKey"));
    let mut other = Database::memory().unwrap();
    call(&mut other, json!({"op":"import","data":backup}));
    assert_eq!(
        call(&mut other, json!({"op":"snapshot"}))["articles"][0]["saved"],
        true
    );
    let mut bad: Value = serde_json::from_str(&backup).unwrap();
    bad["articles"][0]["url"] = json!("javascript:alert(1)");
    assert!(other
        .request(&json!({"op":"import","data":bad.to_string()}), 1)
        .is_err());
    assert_eq!(call(&mut other, json!({"op":"export"})), json!(backup));
    bad = serde_json::from_str(&backup).unwrap();
    bad["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "provider")
        .unwrap()["data"]["apiKey"] = json!("secret");
    assert!(other
        .request(&json!({"op":"import","data":bad.to_string()}), 1)
        .is_err());
    assert_eq!(db.retain(1000 + 90 * 86400).unwrap(), 0);
    call(
        &mut db,
        json!({"op":"article_state","articleId":a["id"],"saved":false}),
    );
    assert_eq!(db.retain(1000 + 90 * 86400).unwrap(), 1);
    assert_eq!(
        call(&mut db, json!({"op":"search","query":"science"})),
        json!([])
    );
}
#[test]
fn refresh_respects_source_intervals_and_retry_after_even_when_manual() {
    let mut db = Database::memory().unwrap();
    let s = source(&mut db);
    let id = s["id"].as_str().unwrap();
    db.ingest(id, &feed("Science discovery"), 1000).unwrap();
    assert!(!db
        .due_sources(1001, false)
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    assert!(db
        .due_sources(3000, false)
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    db.source_failed(id, "HTTP 429; retry after 3600 seconds", 3000)
        .unwrap();
    assert!(!db
        .due_sources(3001, true)
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    assert!(db
        .due_sources(6601, true)
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    call(
        &mut db,
        json!({"op":"source_update","sourceId":id,"enabled":false}),
    );
    assert!(!db
        .due_sources(99000, true)
        .unwrap()
        .iter()
        .any(|s| s["id"] == id));
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["articles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn provider_configuration_never_persists_keys_and_catalog_is_real() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("news.db")).unwrap();
    let s = call(&mut db, json!({"op":"snapshot"}));
    assert!(!s["sources"].as_array().unwrap().is_empty());
    call(
        &mut db,
        json!({"op":"provider_save","provider":{"id":"ollama","kind":"ollama","name":"Local","model":"llama3.2","enabled":true,"consented":true,"apiKey":"must-not-store"}}),
    );
    let backup = call(&mut db, json!({"op":"export"}));
    assert!(!backup.as_str().unwrap().contains("must-not-store"));
    let mut restore = Database::memory().unwrap();
    call(&mut restore, json!({"op":"import","data":backup}));
    let providers = call(&mut restore, json!({"op":"snapshot"}))["providers"]
        .as_array()
        .unwrap()
        .clone();
    assert!(providers
        .iter()
        .all(|p| p["enabled"] == false && p["consented"] == false));
}
#[test]
fn invalid_feed_batch_is_atomic_and_metadata_sources_cannot_store_excerpts() {
    let mut db = Database::memory().unwrap();
    let s = call(
        &mut db,
        json!({"op":"source_add","name":"Metadata","url":"https://example.org/feed","topics":[],"region":"world","language":"en","kind":"discussion","termsUrl":"https://example.org/terms","storage":"metadata"}),
    );
    let mut f = feed("Metadata headline");
    db.ingest(s["id"].as_str().unwrap(), &f, 1000).unwrap();
    let a = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    assert_eq!(a["excerpt"], "");
    f["articles"][0]["title"] = json!("Changed title");
    f["articles"]
        .as_array_mut()
        .unwrap()
        .push(json!({"title":"Bad","url":"file:///C:/secret","excerpt":"bad"}));
    assert!(db.ingest(s["id"].as_str().unwrap(), &f, 1100).is_err());
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["articles"][0]["title"],
        "Metadata headline"
    );
    let mut backup: Value =
        serde_json::from_str(call(&mut db, json!({"op":"export"})).as_str().unwrap()).unwrap();
    backup["articles"][0]["excerpt"] = json!("Not permitted by metadata-only policy");
    assert!(db
        .request(&json!({"op":"import","data":backup.to_string()}), 1)
        .is_err());
}
#[test]
fn grouping_negative_claims_and_search_syntax_do_not_conflate() {
    use news_terminal_lib::intelligence::related;
    let paris = json!({"title":"Paris officials approve new regional transport investment plan following months of public debate over local infrastructure spending priorities","url":"https://example.org/paris","firstSeen":100});
    let berlin = json!({"title":"Berlin officials approve new regional transport investment plan following months of public debate over local infrastructure spending priorities","url":"https://example.org/berlin","firstSeen":100});
    assert!(!related(&paris, &berlin));
    let a = json!({"title":"NASA confirms 100 planets in stellar survey","url":"https://example.org/a","firstSeen":100});
    let b = json!({"title":"NASA confirms 200 planets in stellar survey","url":"https://example.org/b","firstSeen":100});
    assert!(!related(&a, &b));
    let b = json!({"title":"NASA does not confirm 100 planets in stellar survey","url":"https://example.org/b","firstSeen":100});
    assert!(!related(&a, &b));
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(
        src["id"].as_str().unwrap(),
        &feed("Science discovery"),
        1000,
    )
    .unwrap();
    for query in ["\"", "*", "OR", "science OR discovery", "NEAR(science)"] {
        assert!(db
            .request(&json!({"op":"search","query":query}), 1000)
            .is_ok());
    }
}
#[test]
fn ipc_rejects_wrong_profile_types_and_unknown_persisted_workspace_fields() {
    let mut db = Database::memory().unwrap();
    assert!(db
        .request(&json!({"op":"snapshot","profileId":12}), 1)
        .is_err());
    let mut w = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    w["apiKey"] = json!("unexpected-secret");
    assert!(request(&mut db, json!({"op":"workspace_save","workspace":w}), 1).is_err());
    assert!(db.request(&json!({"op":"profile_update","quietHours":{"enabled":true,"start":"22:00","end":"08:00","apiKey":"secret"}}),1).is_err());
}
#[test]
fn migrations_back_up_older_databases_and_refuse_newer_versions() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE legacy(value TEXT); INSERT INTO legacy VALUES('keep me'); PRAGMA user_version=0;").unwrap();
    }
    let db = Database::open(&path).unwrap();
    drop(db);
    assert!(path.with_extension("pre-migration.sqlite3").exists());
    let c = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        c.query_row("SELECT value FROM legacy", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "keep me"
    );
    c.execute_batch("PRAGMA user_version=99;").unwrap();
    drop(c);
    assert!(Database::open(&path).is_err());
}
#[test]
fn saved_story_remains_visible_beyond_recent_cache_window() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(src["id"].as_str().unwrap(), &feed("Saved science"), 1000)
        .unwrap();
    let original = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    call(
        &mut db,
        json!({"op":"article_state","articleId":original["id"],"saved":true}),
    );
    let mut backup: Value =
        serde_json::from_str(call(&mut db, json!({"op":"export"})).as_str().unwrap()).unwrap();
    for i in 0..5000 {
        let mut a = original.clone();
        a["id"] = json!(format!("new-{i}"));
        a["firstSeen"] = json!(2000 + i);
        a["url"] = json!(format!("https://example.org/new/{i}"));
        backup["articles"].as_array_mut().unwrap().push(a);
    }
    call(&mut db, json!({"op":"import","data":backup.to_string()}));
    assert!(call(&mut db, json!({"op":"snapshot"}))["articles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["id"] == original["id"] && a["saved"] == true));
    assert_eq!(
        db.article("default", original["id"].as_str().unwrap())
            .unwrap()["saved"],
        true
    );
}
#[test]
fn tracking_aliases_in_one_feed_are_ingested_once() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    let mut f = feed("Science discovery");
    let mut alias = f["articles"][0].clone();
    alias["url"] = json!("https://example.org/story?item=1&utm_medium=email");
    f["articles"].as_array_mut().unwrap().push(alias);
    assert_eq!(db.ingest(src["id"].as_str().unwrap(), &f, 1000).unwrap(), 1);
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["articles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn import_rejects_unsafe_source_homepage() {
    let mut db = Database::memory().unwrap();
    source(&mut db);
    let mut b: Value =
        serde_json::from_str(call(&mut db, json!({"op":"export"})).as_str().unwrap()).unwrap();
    b["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "source")
        .unwrap()["data"]["homepage"] = json!("javascript:alert(1)");
    assert!(db
        .request(&json!({"op":"import","data":b.to_string()}), 1)
        .is_err());
}
#[test]
fn workspace_requires_revision_and_rejects_unsafe_import_revision() {
    let mut db = Database::memory().unwrap();
    let original = db.export().unwrap();
    let mut ws = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    ws.as_object_mut().unwrap().remove("revision");
    assert!(
        request(&mut db, json!({"op":"workspace_save","workspace":ws}), 1000).is_err(),
        "missing revision must not overwrite"
    );
    assert_eq!(db.export().unwrap(), original);
    for revision in [9_007_199_254_740_991_u64, u64::MAX] {
        let mut backup: Value = serde_json::from_str(&original).unwrap();
        backup["documents"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| d["kind"] == "workspace")
            .unwrap()["data"]["revision"] = json!(revision);
        assert!(
            db.import(&backup.to_string()).is_err(),
            "unsafe revision {revision} imported"
        );
        assert_eq!(db.export().unwrap(), original);
    }
    call(
        &mut db,
        json!({"op":"workspace_save","workspace":ws,"expectedRevision":0}),
    );
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["workspace"]["revision"],
        1
    );
}

#[test]
fn corrected_publication_date_updates_without_resetting_first_seen() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    let sid = src["id"].as_str().unwrap();
    let mut f = feed("Science discovery");
    f["articles"][0]["publishedAt"] = Value::Null;
    db.ingest(sid, &f, 1000).unwrap();
    f["articles"][0]["publishedAt"] = json!(900);
    assert_eq!(db.ingest(sid, &f, 1100).unwrap(), 1);
    let a = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    assert_eq!(a["publishedAt"], 900);
    assert_eq!(a["firstSeen"], 1000);
    assert_eq!(a["updatedAt"], 1100);
    assert_eq!(a["history"].as_array().unwrap().len(), 1);
    assert_eq!(a["history"][0]["at"], 1000);
    assert_eq!(db.ingest(sid, &f, 1200).unwrap(), 0);
    f["articles"][0]["publishedAt"] = json!(999_999_999);
    assert_eq!(db.ingest(sid, &f, 1300).unwrap(), 1);
    assert_eq!(
        db.ingest(sid, &f, 1400).unwrap(),
        0,
        "compare normalized dates, not invalid raw values"
    );
    let a = call(&mut db, json!({"op":"snapshot"}))["articles"][0].clone();
    assert!(a["publishedAt"].is_null());
    assert_eq!(a["firstSeen"], 1000);
    assert_eq!(a["updatedAt"], 1300);
}

#[test]
fn workspace_revision_checked_increment_stops_at_safe_boundary() {
    let mut db = Database::memory().unwrap();
    let mut backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    backup["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "workspace")
        .unwrap()["data"]["revision"] = json!(9_007_199_254_740_989_u64);
    db.import(&backup.to_string()).unwrap();
    let ws = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    call(&mut db, json!({"op":"workspace_save","workspace":ws}));
    let ws = call(&mut db, json!({"op":"snapshot"}))["workspace"].clone();
    assert_eq!(ws["revision"], 9_007_199_254_740_990_u64);
    assert!(
        request(&mut db, json!({"op":"workspace_save","workspace":ws}), 1000)
            .unwrap_err()
            .contains("revision limit")
    );
    let exported = db.export().unwrap();
    Database::memory().unwrap().import(&exported).unwrap();
    assert!(db
        .request(&json!({"op":"profile_create","name":"Still usable"}), 1000)
        .is_ok());
}

fn request(db: &mut Database, mut r: Value, now: i64) -> Result<Value, String> {
    if matches!(
        r["op"].as_str(),
        Some("workspace_save" | "article_state" | "group_split")
    ) {
        r["replacementToken"] = db
            .request(&json!({"op":"workspace_get","profileId":"default"}), now)?
            ["replacementToken"]
            .clone();
    }
    db.request(&r, now)
}
fn call(db: &mut Database, r: Value) -> Value {
    request(db, r, 1_800_000_000).unwrap()
}
fn durable_workspace(mut workspace: Value) -> Value {
    assert!(workspace["replacementToken"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));
    workspace
        .as_object_mut()
        .unwrap()
        .remove("replacementToken");
    workspace
}
#[test]
fn profiles_validate_and_visit_watermark_stays_stable_across_session() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("news.db");
    let mut db = Database::open(&path).unwrap();
    let p = call(&mut db, json!({"op":"profile_create","name":"Science"}));
    let id = p["id"].as_str().unwrap();
    call(
        &mut db,
        json!({"op":"profile_update","profileId":id,"preferences":{"topics":["science"]}}),
    );
    assert!(db
        .request(
            &json!({"op":"profile_update","profileId":id,"preferences":{"diversityCap":2}}),
            1
        )
        .is_err());
    assert_eq!(
        db.request(&json!({"op":"visit","profileId":id}), 100)
            .unwrap()["previousVisit"],
        0
    );
    assert_eq!(
        db.request(&json!({"op":"visit","profileId":id}), 200)
            .unwrap()["lastVisit"],
        100
    );
    drop(db);
    let mut db = Database::open(&path).unwrap();
    let p = db
        .request(&json!({"op":"visit","profileId":id}), 300)
        .unwrap();
    assert_eq!(p["previousVisit"], 100);
    assert_eq!(p["preferences"]["topics"], json!(["science"]));
    assert_eq!(
        call(&mut db, json!({"op":"snapshot"}))["profile"]["preferences"]["topics"],
        json!([])
    );
}
#[test]
fn fresh_database_has_contract_defaults_and_no_demo_articles() {
    let mut db = Database::memory().unwrap();
    let s = call(&mut db, json!({"op":"snapshot","profileId":"default"}));
    assert_eq!(s["profile"]["id"], "default");
    assert_eq!(s["articles"], json!([]));
    assert_eq!(s["profile"]["preferences"]["languages"], json!(["en"]));
    assert_eq!(s["providers"].as_array().unwrap().len(), 3);
    assert!(s["providers"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["enabled"] == false && p["consented"] == false));
    assert_eq!(s["workspace"]["activeTabId"], "home");
}
