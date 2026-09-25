use chrono::{Local, TimeZone};
use news_terminal_lib::db::Database;
use serde_json::{json, Value};

fn source(db: &mut Database) -> Value {
    db.request(&json!({"op":"source_add","name":"Science desk","url":"https://example.org/feed","topics":["science"],"region":"world","language":"en","kind":"reporting","termsUrl":"https://example.org/terms","storage":"excerpt"}), 1_800_000_000).unwrap()
}

#[test]
fn daily_request_is_profile_scoped_preserves_hidden_state_and_strictly_validates_dates() {
    let now = 1_800_000_000;
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(src["id"].as_str().unwrap(), &json!({"articles":[{"title":"Science bulletin","url":"https://example.org/article","excerpt":"A supplied lead","publishedAt":now}]}), now).unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), now).unwrap();
    let article = &snapshot["articles"][0];
    let other = db
        .request(&json!({"op":"profile_create","name":"Second profile"}), now)
        .unwrap();
    guarded(
        &mut db,
        json!({"op":"article_state","articleId":article["id"],"hidden":true,"saved":true}),
        now,
    )
    .unwrap();
    assert_eq!(
        db.request(&json!({"op":"daily_brief"}), now).unwrap()["articleCount"],
        0
    );
    assert_eq!(
        db.request(&json!({"op":"daily_brief","profileId":other["id"]}), now)
            .unwrap()["articleCount"],
        1
    );
    db.request(
        &json!({"op":"profile_update","profileId":other["id"],"preferences":{"topics":["sports"]}}),
        now,
    )
    .unwrap();
    assert_eq!(
        db.request(&json!({"op":"daily_brief","profileId":other["id"]}), now)
            .unwrap()["articleCount"],
        0
    );
    for date in [
        json!("2026-2-01"),
        json!("2026-02-30"),
        json!("2026-09-23T00:00:00Z"),
        json!("+10000-01-01"),
        json!("-0001-01-01"),
        json!(" 2026-09-23"),
        Value::Null,
        json!(42),
    ] {
        assert!(
            db.request(&json!({"op":"daily_brief","date":date}), now)
                .is_err(),
            "accepted {date}"
        );
    }
    assert!(db
        .request(&json!({"op":"daily_brief","profileId":"missing"}), now)
        .is_err());
    let leap = db
        .request(&json!({"op":"daily_brief","date":"2024-02-29"}), now)
        .unwrap();
    assert_eq!(leap["date"], "2024-02-29");
    assert_eq!(leap["articleCount"], 0);
}

#[test]
fn calendar_report_counts_stored_day_entries_beyond_snapshot_window() {
    let now = 1_800_000_000;
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(src["id"].as_str().unwrap(), &json!({"articles":[{"title":"Retained news","url":"https://example.org/retained","excerpt":"Source lead","publishedAt":now}]}), now).unwrap();
    let mut backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    let original = backup["articles"][0].clone();
    backup["articles"] = json!((0..5001)
        .map(|n| {
            let mut a = original.clone();
            a["id"] = json!(format!("retained-{n}"));
            a["firstSeen"] = json!(now - n);
            a
        })
        .collect::<Vec<_>>());
    db.import(&backup.to_string()).unwrap();
    assert_eq!(
        db.request(&json!({"op":"daily_brief"}), now).unwrap()["articleCount"],
        5001
    );
}

#[test]
fn grouping_does_not_hide_discussion_or_distinct_numeric_claims() {
    use news_terminal_lib::briefing::{build, DayBounds};
    let day = DayBounds {
        date: "2026-09-23".into(),
        start: 100,
        end: 200,
    };
    let mut reporting = article("reporting", json!(130));
    reporting["title"] = json!("Agency confirms 100 cases in new scientific study");
    let mut discussion = reporting.clone();
    discussion["id"] = json!("discussion");
    discussion["kind"] = json!("discussion");
    let mut changed_claim = reporting.clone();
    changed_claim["id"] = json!("different");
    changed_claim["url"] = json!("https://example.org/different");
    changed_claim["title"] = json!("Agency confirms 200 cases in new scientific study");
    let brief = build(
        &[reporting, discussion, changed_claim],
        &json!({}),
        &day,
        150,
    );
    assert_eq!(
        sector(&brief, "science")["items"].as_array().unwrap().len(),
        3
    );
}

#[test]
fn focused_sections_lead_briefing_without_losing_topic_detail() {
    use news_terminal_lib::briefing::{build, DayBounds};
    let day = DayBounds {
        date: "2026-09-23".into(),
        start: 100,
        end: 200,
    };
    let mut ai = article("ai-chip", json!(150));
    ai["title"] = json!("AI chip maker reports earnings");
    ai["topics"] = json!(["technology", "business", "markets"]);
    ai["sections"] = json!(["ai", "technology", "stocks"]);
    let mut local = article("local", json!(140));
    local["topics"] = json!(["science"]);
    local["sections"] = json!(["others"]);
    let brief = build(&[ai, local], &json!({}), &day, 160);
    let ids: Vec<_> = brief["sectors"]
        .as_array()
        .unwrap()
        .iter()
        .take(4)
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["ai", "technology", "stocks", "others"]);
    assert_eq!(sector(&brief, "ai")["articleCount"], 1);
    assert_eq!(sector(&brief, "technology")["articleCount"], 1);
    assert_eq!(sector(&brief, "stocks")["articleCount"], 1);
    assert_eq!(sector(&brief, "others")["articleCount"], 1);
    assert_eq!(sector(&brief, "markets")["articleCount"], 1);
    assert_eq!(sector(&brief, "science")["articleCount"], 1);
}

#[test]
fn every_profile_filter_applies_even_to_saved_articles() {
    use news_terminal_lib::briefing::{build, DayBounds};
    let day = DayBounds {
        date: "2026-09-23".into(),
        start: 100,
        end: 200,
    };
    let mut a = article("saved", json!(130));
    a["saved"] = json!(true);
    let preferences = json!({"topics":["science"],"keywords":["Story"],"sources":["source-a"],"regions":["world"],"languages":["en"]});
    assert_eq!(
        build(&[a.clone()], &preferences, &day, 150)["articleCount"],
        1
    );
    for key in ["topics", "keywords", "sources", "regions", "languages"] {
        let mut p = preferences.clone();
        p[key] = json!(["no-match"]);
        assert_eq!(
            build(&[a.clone()], &p, &day, 150)["articleCount"],
            0,
            "filter {key}"
        );
    }
}

#[test]
fn undated_entries_are_first_seen_counts_not_fabricated_publication_dates() {
    let now = 1_800_000_000;
    let mut db = Database::memory().unwrap();
    let src = source(&mut db);
    db.ingest(src["id"].as_str().unwrap(), &json!({"articles":[{"title":"Missing date","url":"https://example.org/no-date","excerpt":"No date in source","publishedAt":null}]}), now).unwrap();
    let brief = db.request(&json!({"op":"daily_brief"}), now).unwrap();
    assert_eq!(brief["undatedCount"], 1);
    assert_eq!(brief["articleCount"], 0);
    assert_eq!(brief["sectors"][4]["items"], json!([]));
    assert_eq!(
        db.request(&json!({"op":"daily_brief","date":"2024-01-01"}), now)
            .unwrap()["undatedCount"],
        0
    );
}

#[test]
fn briefing_and_live_workspace_modes_persist_and_roundtrip_without_opening_arbitrary_modes() {
    let mut db = Database::memory().unwrap();
    let now = 1_800_000_000;
    let mut workspace = db.request(&json!({"op":"snapshot"}), now).unwrap()["workspace"].clone();
    workspace["tabs"] = json!([
        {"id":"briefing","title":"Daily sectors","topic":"","query":"","mode":"briefing"},
        {"id":"live","title":"Live desk","topic":"","query":"","mode":"live"}
    ]);
    workspace["activeTabId"] = json!("briefing");
    guarded(
        &mut db,
        json!({"op":"workspace_save","workspace":workspace,"expectedRevision":0}),
        now,
    )
    .unwrap();
    let stored = db.request(&json!({"op":"snapshot"}), now).unwrap()["workspace"].clone();
    assert_eq!(stored["tabs"], workspace["tabs"]);
    assert_eq!(stored["revision"], 1);
    assert!(db
        .workspace_owner_exists("default", Some("briefing"))
        .unwrap());
    assert!(db.workspace_owner_exists("default", Some("live")).unwrap());
    assert!(guarded(
        &mut db,
        json!({"op":"workspace_save","workspace":workspace,"expectedRevision":0}),
        now
    )
    .is_err());
    let backup = db.export().unwrap();
    let mut restored = Database::memory().unwrap();
    restored.import(&backup).unwrap();
    assert_eq!(
        restored.request(&json!({"op":"snapshot"}), now).unwrap()["workspace"],
        stored
    );
    for invalid in ["stream", "arbitrary", "", "BRIEFING"] {
        let mut invalid_workspace = stored.clone();
        invalid_workspace["tabs"][0]["mode"] = json!(invalid);
        assert!(guarded(
            &mut db,
            json!({"op":"workspace_save","workspace":invalid_workspace,"expectedRevision":1}),
            now
        )
        .is_err());
        let mut invalid_backup: Value = serde_json::from_str(&backup).unwrap();
        for d in invalid_backup["documents"].as_array_mut().unwrap() {
            if d["kind"] == "workspace" {
                d["data"] = invalid_workspace.clone();
            }
        }
        assert!(restored.import(&invalid_backup.to_string()).is_err());
    }
    assert_eq!(restored.export().unwrap(), backup);
}

fn article(id: &str, published: Value) -> Value {
    json!({"id":id,"title":format!("Story {id}"),"url":format!("https://example.org/{id}"),"sourceId":"source-a","sourceName":"Desk A","publishedAt":published,"firstSeen":110,"topics":["science"],"region":"world","language":"en","kind":"reporting","excerpt":"Source excerpt","aiAllowed":false,"hidden":false,"saved":false,"groupId":id})
}

fn sector<'a>(brief: &'a Value, id: &str) -> &'a Value {
    brief["sectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|sector| sector["id"] == id)
        .unwrap()
}

#[test]
fn explicit_day_counts_only_matching_visible_published_entries_and_separates_undated() {
    use news_terminal_lib::briefing::{build, DayBounds};
    let day = DayBounds {
        date: "2026-09-23".into(),
        start: 100,
        end: 200,
    };
    let mut hidden = article("hidden", json!(130));
    hidden["hidden"] = json!(true);
    let mut saved_foreign = article("saved-foreign", json!(130));
    saved_foreign["saved"] = json!(true);
    saved_foreign["language"] = json!("fr");
    let mut excluded = article("excluded", json!(130));
    excluded["title"] = json!("Blocked subject");
    let entries = vec![
        article("start", json!(100)),
        article("now", json!(150)),
        article("before", json!(99)),
        article("end", json!(200)),
        article("future", json!(151)),
        article("undated", Value::Null),
        hidden,
        saved_foreign,
        excluded,
    ];
    let brief = build(
        &entries,
        &json!({"languages":["en"],"excludeKeywords":["blocked"]}),
        &day,
        150,
    );
    assert_eq!(brief["articleCount"], 2);
    assert_eq!(brief["undatedCount"], 1);
    let science = sector(&brief, "science");
    assert_eq!(science["articleCount"], 2);
    assert_eq!(science["sourceCount"], 1);
    assert_eq!(science["items"][0]["id"], "now");
    assert_eq!(science["items"][0]["aiAllowed"], false);
    assert!(science["outline"][0]
        .as_str()
        .unwrap()
        .contains("Story now"));
    assert!(science["outline"][0]
        .as_str()
        .unwrap()
        .contains("https://example.org/now"));
    assert!(brief["coverageLabel"]
        .as_str()
        .unwrap()
        .contains("not an AI"));
}

#[test]
fn sectors_deduplicate_conservatively_keep_original_counts_and_limit_items() {
    use news_terminal_lib::briefing::{build, DayBounds};
    let day = DayBounds {
        date: "2026-09-23".into(),
        start: 100,
        end: 200,
    };
    let mut entries: Vec<Value> = (0..15)
        .map(|n| article(&format!("a{n:02}"), json!(140)))
        .collect();
    let mut duplicate = entries[0].clone();
    duplicate["id"] = json!("duplicate");
    duplicate["sourceId"] = json!("second-source");
    duplicate["sourceName"] = json!("Second desk");
    entries.push(duplicate);
    let mut custom = article("custom", json!(130));
    custom["topics"] = json!(["culture", "local", "local"]);
    entries.push(custom);
    let mut unclassified = article("unclassified", json!(140));
    unclassified["topics"] = json!([]);
    entries.push(unclassified);
    let brief = build(&entries, &json!({}), &day, 150);
    assert_eq!(brief["articleCount"], 18);
    let sectors = brief["sectors"].as_array().unwrap();
    let science = sector(&brief, "science");
    assert_eq!(science["articleCount"], 16);
    assert_eq!(science["sourceCount"], 2);
    assert_eq!(science["items"].as_array().unwrap().len(), 12);
    assert_eq!(science["items"][0]["id"], "a00");
    assert_eq!(
        sectors.iter().find(|s| s["id"] == "local").unwrap()["articleCount"],
        1
    );
    assert_eq!(
        sectors.iter().find(|s| s["id"] == "unclassified").unwrap()["articleCount"],
        1
    );
    entries.reverse();
    assert_eq!(brief, build(&entries, &json!({}), &day, 150));
    let pair = vec![
        entries.iter().find(|a| a["id"] == "a00").unwrap().clone(),
        entries
            .iter()
            .find(|a| a["id"] == "duplicate")
            .unwrap()
            .clone(),
    ];
    assert_eq!(
        sector(&build(&pair, &json!({}), &day, 150), "science")["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut split = pair.clone();
    split[1]["groupId"] = json!("split:default:duplicate");
    assert_eq!(
        sector(&build(&split, &json!({}), &day, 150), "science")["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn daily_brief_request_reports_local_day_and_empty_sector_gaps() {
    let mut db = Database::memory().unwrap();
    let now = 1_800_000_000;
    let brief = db
        .request(&json!({"op":"daily_brief","profileId":"default"}), now)
        .unwrap();
    assert_eq!(
        brief["date"],
        Local
            .timestamp_opt(now, 0)
            .unwrap()
            .format("%Y-%m-%d")
            .to_string()
    );
    assert!(brief["dayStart"].as_i64().unwrap() <= now);
    assert!(brief["dayEnd"].as_i64().unwrap() > now);
    assert_eq!(brief["generatedAt"], now);
    assert_eq!(brief["articleCount"], 0);
    assert_eq!(brief["undatedCount"], 0);
    assert_eq!(brief["sectors"].as_array().unwrap().len(), 14);
    assert!(brief["coverageLabel"].as_str().unwrap().contains("profile"));
    for sector in brief["sectors"].as_array().unwrap() {
        assert_eq!(sector["articleCount"], 0);
        assert_eq!(sector["sourceCount"], 0);
        assert_eq!(sector["items"], json!([]));
        assert!(sector["outline"][0]
            .as_str()
            .unwrap()
            .contains("No retrieved"));
    }
}

fn guarded(db: &mut Database, mut request: Value, now: i64) -> Result<Value, String> {
    request["replacementToken"] = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)?["replacementToken"]
        .clone();
    db.request(&request, now)
}
