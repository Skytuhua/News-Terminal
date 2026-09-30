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
fn every_tab_mode_the_renderer_can_produce_is_accepted_by_the_host() {
    // 0.5 shipped the Alert history view as a tab mode. The host validates tab
    // modes against its own list, and the browser fixture never reaches that
    // validation, so a mode the renderer can produce but the host rejects
    // fails open in the browser and silently in the packaged app. These two
    // lists must stay in step; this test is what makes the drift fail loudly.
    for mode in [
        "all",
        "saved",
        "brief",
        "watchlist",
        "briefing",
        "live",
        "hidden",
        "alerts",
    ] {
        let mut db = Database::memory().unwrap();
        call(&mut db, json!({"op":"profile_create","name":"Default"}));
        let mut workspace = json!({
            "tabs":[{"id":"home","title":"T","topic":"","query":"","mode":mode}],
            "activeTabId":"home","revision":0
        });
        workspace["tabs"][0]["mode"] = json!(mode);
        request(
            &mut db,
            json!({"op":"workspace_save","workspace":workspace}),
            1,
        )
        .unwrap_or_else(|e| panic!("host rejected renderer tab mode {mode:?}: {e}"));
    }
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

#[test]
fn article_state_many_matches_single_article_state_for_one_item() {
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    let sid = src["id"].as_str().unwrap();
    let now = 1_800_000_000;
    for (n, id) in ["solo-single", "solo-many"].into_iter().enumerate() {
        db.ingest(
            sid,
            &json!({"notModified":false,"etag":format!("v{n}"),"articles":[{"id":id,"title":format!("Story {n}"),"url":format!("https://example.org/{id}"),"excerpt":"Permitted science excerpt","publishedAt":1_799_999_000}]}),
            now,
        )
        .unwrap();
    }
    let articles = call(&mut db, json!({"op":"snapshot"}))["articles"].clone();
    let single = articles[0]["id"].clone();
    let many = articles[1]["id"].clone();
    // The batched item carries every documented key, including an explicit false
    // alongside true, so equivalence cannot be satisfied by ignoring keys.
    call(
        &mut db,
        json!({"op":"article_state","profileId":"default","articleId":single,"read":true,"saved":true,"hidden":true}),
    );
    assert_eq!(
        call(
            &mut db,
            json!({"op":"article_state_many","profileId":"default","items":[
                {"articleId":many,"read":true,"saved":true,"hidden":true}
            ]}),
        ),
        json!(null)
    );
    let single_state = db.article("default", single.as_str().unwrap()).unwrap();
    let many_state = db.article("default", many.as_str().unwrap()).unwrap();
    for key in ["read", "saved", "hidden"] {
        assert_eq!(
            single_state[key], many_state[key],
            "batch key {key} diverged from the single path"
        );
        assert_eq!(
            single_state[key], true,
            "single path must have written {key}"
        );
    }
    // An absent key must leave the stored value alone in both paths.
    call(
        &mut db,
        json!({"op":"article_state","profileId":"default","articleId":single,"read":false}),
    );
    call(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[{"articleId":many,"read":false}]}),
    );
    let a = db.article("default", single.as_str().unwrap()).unwrap();
    let b = db.article("default", many.as_str().unwrap()).unwrap();
    assert_eq!(a["read"], json!(false));
    assert_eq!(a["saved"], json!(true));
    assert_eq!(b["read"], json!(false));
    assert_eq!(b["saved"], json!(true));
}

#[test]
fn article_state_many_applies_multi_key_items_in_read_saved_hidden_order() {
    let mut db = Database::memory().unwrap();
    let ids = seed_articles(&mut db, &["order-a", "order-b", "order-c", "order-d"]);
    // Each item carries all three keys with the JSON keys deliberately reversed.
    // The single path validates and applies read, then saved, then hidden, so an
    // item whose `read` is not a boolean must fail on `read` even though
    // `hidden` is also invalid: that is the observable application order.
    let error = request(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[
            {"hidden":"nope","saved":true,"read":1,"articleId":ids[0]}
        ]}),
        1_800_000_000,
    )
    .unwrap_err();
    assert_eq!(error, "Expected boolean", "read must be validated first");
    assert_eq!(
        db.article("default", ids[0].as_str().unwrap()).unwrap()["read"],
        json!(false),
        "a rejected item must not write any of its keys"
    );
    let hidden_error = request(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[
            {"hidden":2,"saved":true,"read":true,"articleId":ids[0]}
        ]}),
        1_800_000_000,
    )
    .unwrap_err();
    assert_eq!(hidden_error, "Expected boolean", "hidden is validated last");
    // Now apply the three keys together, plus a partial item, and compare the
    // stored result with what the single path produces for the same keys.
    call(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[
            {"hidden":true,"saved":true,"read":true,"articleId":ids[0]},
            {"saved":true,"articleId":ids[1]},
            {"hidden":true,"articleId":ids[2]}
        ]}),
    );
    call(
        &mut db,
        json!({"op":"article_state","articleId":ids[3],"read":true,"saved":true,"hidden":true}),
    );
    let batched = db.article("default", ids[0].as_str().unwrap()).unwrap();
    let single = db.article("default", ids[3].as_str().unwrap()).unwrap();
    for key in ["read", "saved", "hidden"] {
        assert_eq!(batched[key], single[key], "{key} diverged");
    }
    assert_eq!(batched["saved"], json!(true));
    assert_eq!(batched["hidden"], json!(true));
    assert_eq!(batched["read"], json!(true));
    // A partial item sets only its own key; unmentioned keys keep their value.
    let partial = db.article("default", ids[1].as_str().unwrap()).unwrap();
    assert_eq!(partial["saved"], json!(true));
    assert_eq!(partial["read"], json!(false));
    assert_eq!(partial["hidden"], json!(false));
    // A groupId written by the single-article split path must survive a batch.
    call(&mut db, json!({"op":"group_split","articleId":ids[2]}));
    let split = db.article("default", ids[2].as_str().unwrap()).unwrap()["groupId"].clone();
    call(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[{"articleId":ids[2],"read":true}]}),
    );
    let after = db.article("default", ids[2].as_str().unwrap()).unwrap();
    assert_eq!(after["groupId"], split, "batch must not drop groupId");
    assert_eq!(
        after["hidden"],
        json!(true),
        "unmentioned keys keep their value"
    );
    assert_eq!(after["read"], json!(true));
}

#[test]
fn article_state_many_rejects_the_whole_batch_on_an_unknown_article() {
    let mut db = Database::memory().unwrap();
    let ids = seed_articles(&mut db, &["batch-a", "batch-b", "batch-c"]);
    let before = db.export().unwrap();
    // The unknown id sits in the middle, so a per-item commit would leave the
    // first item written and the batch half applied.
    let error = request(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[
            {"articleId":ids[0],"read":true,"saved":true},
            {"articleId":"not-a-real-article","read":true},
            {"articleId":ids[2],"hidden":true}
        ]}),
        1_800_000_000,
    )
    .unwrap_err();
    assert_eq!(error, "Unknown article");
    for id in &ids {
        let a = db.article("default", id.as_str().unwrap()).unwrap();
        assert_eq!(a["read"], json!(false), "{id} must not be read");
        assert_eq!(a["saved"], json!(false), "{id} must not be saved");
        assert_eq!(a["hidden"], json!(false), "{id} must not be hidden");
    }
    assert_eq!(
        db.export().unwrap(),
        before,
        "a rejected batch must leave no partial write"
    );
    // An unknown id anywhere, including last, still rejects the whole batch.
    for position in [0usize, 2] {
        let mut items = vec![
            json!({"articleId":ids[0],"read":true}),
            json!({"articleId":ids[1],"read":true}),
        ];
        items.insert(position, json!({"articleId":"missing-id","read":true}));
        assert_eq!(
            request(
                &mut db,
                json!({"op":"article_state_many","profileId":"default","items":items}),
                1_800_000_000
            )
            .unwrap_err(),
            "Unknown article",
            "unknown id at position {position}"
        );
        assert_eq!(
            db.export().unwrap(),
            before,
            "no partial write at {position}"
        );
    }
    // The same batch without the unknown id commits completely.
    call(
        &mut db,
        json!({"op":"article_state_many","profileId":"default","items":[
            {"articleId":ids[0],"read":true},
            {"articleId":ids[1],"saved":true},
            {"articleId":ids[2],"hidden":true}
        ]}),
    );
    for id in &ids {
        assert!(
            db.export().unwrap().contains(id.as_str().unwrap()),
            "{id} must be stored"
        );
    }
    assert_eq!(
        db.article("default", ids[0].as_str().unwrap()).unwrap()["read"],
        json!(true)
    );
    assert_eq!(
        db.article("default", ids[1].as_str().unwrap()).unwrap()["saved"],
        json!(true)
    );
    assert_eq!(
        db.article("default", ids[2].as_str().unwrap()).unwrap()["hidden"],
        json!(true)
    );
}

#[test]
fn article_state_many_is_profile_scoped_and_never_writes_another_profile() {
    let mut db = Database::memory().unwrap();
    let ids = seed_articles(&mut db, &["scope-a", "scope-b"]);
    let other = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    let other_id = other["id"].clone();
    call(
        &mut db,
        json!({"op":"article_state","profileId":"default","articleId":ids[0],"saved":true,"read":true}),
    );
    let default_before = db.export().unwrap();
    // Profile A holds the state; a batch sent for profile B must never see it
    // and must never reach back into A.
    call(
        &mut db,
        json!({"op":"article_state_many","profileId":other_id,"items":[{"articleId":ids[0],"hidden":true}]}),
    );
    let a = db.article("default", ids[0].as_str().unwrap()).unwrap();
    assert_eq!(a["hidden"], json!(false), "profile A must be untouched");
    assert_eq!(a["saved"], json!(true));
    let b = db
        .article(other_id.as_str().unwrap(), ids[0].as_str().unwrap())
        .unwrap();
    assert_eq!(b["hidden"], json!(true));
    assert_eq!(
        b["saved"],
        json!(false),
        "profile B must not inherit A's state"
    );
    assert_eq!(b["read"], json!(false));
    assert_ne!(
        default_before,
        db.export().unwrap(),
        "profile A's own rows are unchanged, so only B's row may differ"
    );
    // The same article id batched for an unknown profile is rejected, not
    // silently redirected to the default profile.
    for bad in ["missing-profile".to_owned(), String::new(), "x".repeat(201)] {
        assert!(
            request(
                &mut db,
                json!({"op":"article_state_many","profileId":bad,"items":[{"articleId":ids[1],"read":true}]}),
                1_800_000_000
            )
            .is_err(),
            "accepted profile {bad}"
        );
    }
    for bad in [Value::Null, json!(false), json!(1), json!([]), json!({})] {
        assert!(
            request(
                &mut db,
                json!({"op":"article_state_many","profileId":bad,"items":[{"articleId":ids[1],"read":true}]}),
                1_800_000_000
            )
            .is_err(),
            "accepted profile {bad}"
        );
    }
    // A missing profileId must not fall back to `default`.
    assert!(request(
        &mut db,
        json!({"op":"article_state_many","items":[{"articleId":ids[1],"read":true}]}),
        1_800_000_000
    )
    .is_err());
    assert_eq!(
        db.article("default", ids[1].as_str().unwrap()).unwrap()["read"],
        json!(false),
        "a rejected batch must not write to the default profile"
    );
}

#[test]
fn article_state_many_fails_closed_on_a_stale_or_missing_replacement_token() {
    let mut db = Database::memory().unwrap();
    let ids = seed_articles(&mut db, &["token-a", "token-b"]);
    let token = db
        .request(
            &json!({"op":"workspace_get","profileId":"default"}),
            1_800_000_000,
        )
        .unwrap()["replacementToken"]
        .clone();
    // An import rotates the replacement token; the old one must not write.
    let backup = db.export().unwrap();
    db.import(&backup).unwrap();
    let rotated = db
        .request(
            &json!({"op":"workspace_get","profileId":"default"}),
            1_800_000_000,
        )
        .unwrap()["replacementToken"]
        .clone();
    assert_ne!(rotated, token, "import must rotate the token for this test");
    fn batch(db: &mut Database, ids: &[Value], extra: Option<Value>) -> Result<Value, String> {
        let mut r = json!({"op":"article_state_many","profileId":"default","items":[
            {"articleId":ids[0],"read":true,"saved":true},
            {"articleId":ids[1],"hidden":true}
        ]});
        if let Some(token) = extra {
            r["replacementToken"] = token;
        }
        // Deliberately not the `request` helper: it injects the current token,
        // which is exactly what this test must not do.
        db.request(&r, 1_800_000_000)
    }
    for bad in [
        Some(token.clone()),
        Some(json!("")),
        None,
        Some(Value::Null),
        Some(json!(7)),
        Some(json!([])),
    ] {
        let error = batch(&mut db, &ids, bad.clone()).unwrap_err();
        assert!(
            error.contains("Database replaced"),
            "unexpected error for {bad:?}: {error}"
        );
        for id in &ids {
            let a = db.article("default", id.as_str().unwrap()).unwrap();
            assert_eq!(a["read"], json!(false), "{id} must not be read");
            assert_eq!(a["saved"], json!(false), "{id} must not be saved");
            assert_eq!(a["hidden"], json!(false), "{id} must not be hidden");
        }
    }
    // The single-article path rejects the same token with the same error, so the
    // batch is not inventing a stricter or looser guard than its sibling.
    assert_eq!(
        db.request(
            &json!({"op":"article_state","profileId":"default","articleId":ids[0],"read":true,"replacementToken":token}),
            1_800_000_000
        )
        .unwrap_err(),
        batch(&mut db, &ids, Some(token)).unwrap_err()
    );
    // The current token still commits the whole batch.
    assert_eq!(batch(&mut db, &ids, Some(rotated)), Ok(json!(null)));
    assert_eq!(
        db.article("default", ids[0].as_str().unwrap()).unwrap()["read"],
        json!(true)
    );
    assert_eq!(
        db.article("default", ids[1].as_str().unwrap()).unwrap()["hidden"],
        json!(true)
    );
}

#[test]
fn alert_receipts_returns_only_this_profiles_deliveries_newest_first() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("receipts.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let ids = seed_articles(&mut db, &["receipt-a", "receipt-b", "receipt-c"]);
    let other = call(&mut db, json!({"op":"profile_create","name":"Other"}));
    let other_id = other["id"].as_str().unwrap().to_owned();
    // Deliveries are written directly so the fixture controls the timestamps
    // exactly; the retention window is the one the host already prunes with.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        for (n, id) in ids.iter().enumerate() {
            let at = now - (n as i64) * 60;
            conn.execute(
                "INSERT INTO alert_log(profile_id,article_id,at) VALUES('default',?1,?2)",
                rusqlite::params![id.as_str(), at],
            )
            .unwrap();
        }
        // Same article id, another profile: must never appear in default's list.
        conn.execute(
            "INSERT INTO alert_log(profile_id,article_id,at) VALUES(?1,?2,?3)",
            rusqlite::params![other_id.as_str(), ids[0].as_str(), now - 10],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO alert_log(profile_id,article_id,at) VALUES(?1,?2,?3)",
            rusqlite::params![other_id.as_str(), "foreign-only", now - 5],
        )
        .unwrap();
    }
    let receipts = call(
        &mut db,
        json!({"op":"alert_receipts","profileId":"default"}),
    );
    let rows = receipts.as_array().unwrap();
    assert_eq!(rows.len(), 3, "another profile's receipts must not appear");
    // Receipts were inserted newest-first, so newest-first retrieval returns
    // them in that same order regardless of how the snapshot happened to sort.
    assert_eq!(
        rows.iter()
            .map(|r| r["articleId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            ids[0].as_str().unwrap(),
            ids[1].as_str().unwrap(),
            ids[2].as_str().unwrap()
        ],
        "receipts must be newest first"
    );
    assert_eq!(rows[0]["at"], json!(now));
    assert_eq!(rows[0]["profileId"], json!("default"));
    // A receipt is a local delivery record: identity, time, and the title the
    // user was shown. No other profile, no provider key, no URL, no credentials.
    for row in rows {
        let mut keys: Vec<&str> = row
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["articleId", "at", "profileId", "title"],
            "unexpected receipt shape"
        );
    }
    assert_eq!(
        rows[0]["title"],
        db.article("default", ids[0].as_str().unwrap()).unwrap()["title"]
    );
    assert!(
        !rows[0].to_string().contains("example.org/story"),
        "no source URL in a receipt"
    );
    // Bounded, with an explicit limit the caller can lower but not exceed.
    assert_eq!(
        call(
            &mut db,
            json!({"op":"alert_receipts","profileId":"default","limit":2})
        )
        .as_array()
        .unwrap()
        .len(),
        2
    );
    assert_eq!(
        call(
            &mut db,
            json!({"op":"alert_receipts","profileId":"default","limit":1})
        )
        .as_array()
        .unwrap()[0]["articleId"],
        ids[0]
    );
    // The other profile sees only its own rows.
    let theirs = call(&mut db, json!({"op":"alert_receipts","profileId":other_id}));
    assert_eq!(theirs.as_array().unwrap().len(), 2);
    assert!(theirs
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["profileId"] == json!(other_id)));
    assert_eq!(
        theirs.as_array().unwrap()[0]["articleId"],
        json!("foreign-only")
    );
    // A missing or unknown profile is rejected rather than defaulted.
    let before = db.export().unwrap();
    for bad in [
        json!({"op":"alert_receipts"}),
        json!({"op":"alert_receipts","profileId":"missing-profile"}),
        json!({"op":"alert_receipts","profileId":""}),
        json!({"op":"alert_receipts","profileId":Value::Null}),
    ] {
        assert!(
            request(&mut db, bad.clone(), now).is_err(),
            "accepted {bad}"
        );
    }
    for bad in [json!(0), json!(-1), json!("3"), json!(null), json!(true)] {
        assert!(
            request(
                &mut db,
                json!({"op":"alert_receipts","profileId":"default","limit":bad}),
                now
            )
            .is_err(),
            "accepted limit {bad}"
        );
    }
    assert_eq!(
        call(
            &mut db,
            json!({"op":"alert_receipts","profileId":"default","limit":9000})
        )
        .as_array()
        .unwrap()
        .len(),
        3,
        "an over-large limit is clamped, not an error"
    );
    assert_eq!(
        db.export().unwrap(),
        before,
        "reads must not mutate durable state"
    );
}

#[test]
fn alert_receipts_honour_the_existing_ninety_day_retention() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("receipt-retention.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let ids = seed_articles(&mut db, &["retained", "expired"]);
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO alert_log(profile_id,article_id,at) VALUES('default',?1,?2)",
            rusqlite::params![ids[0].as_str(), now - 89 * 86400],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO alert_log(profile_id,article_id,at) VALUES('default',?1,?2)",
            rusqlite::params![ids[1].as_str(), now - 91 * 86400],
        )
        .unwrap();
    }
    // Before pruning, retention is the host's own rule, not a read-time filter:
    // the read must not surface a receipt the 90-day policy has already expired.
    let receipts = call(
        &mut db,
        json!({"op":"alert_receipts","profileId":"default"}),
    );
    let rows = receipts.as_array().unwrap();
    assert!(
        rows.iter().all(|r| r["articleId"] != ids[1]),
        "a receipt older than 90 days must not be surfaced"
    );
    db.retain(now).unwrap();
    let after = call(
        &mut db,
        json!({"op":"alert_receipts","profileId":"default"}),
    );
    assert_eq!(after.as_array().unwrap().len(), rows.len());
    assert!(
        after
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["articleId"] == ids[0]),
        "the retained receipt stays visible"
    );
    // A receipt whose article has been pruned is still an honest record: it
    // reports the id and time without inventing a title.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO alert_log(profile_id,article_id,at) VALUES('default','pruned-article',?1)",
            rusqlite::params![now],
        )
        .unwrap();
    }
    let with_orphan = call(
        &mut db,
        json!({"op":"alert_receipts","profileId":"default"}),
    );
    let orphan = with_orphan
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["articleId"] == json!("pruned-article"))
        .unwrap();
    assert!(
        orphan["title"].is_null(),
        "a missing article must not fabricate a title"
    );
}

fn seed_articles(db: &mut Database, keys: &[&str]) -> Vec<Value> {
    let src = source(db);
    let sid = src["id"].as_str().unwrap();
    for key in keys {
        db.ingest(
            sid,
            &json!({"notModified":false,"etag":format!("seed-{key}"),"articles":[{"id":key,"title":format!("Story {key}"),"url":format!("https://example.org/{key}"),"excerpt":"Permitted science excerpt","publishedAt":1_799_999_000}]}),
            1_800_000_000,
        )
        .unwrap();
    }
    call(db, json!({"op":"snapshot"}))["articles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].clone())
        .collect()
}

fn request(db: &mut Database, mut r: Value, now: i64) -> Result<Value, String> {
    if matches!(
        r["op"].as_str(),
        Some("workspace_save" | "article_state" | "group_split" | "article_state_many")
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
