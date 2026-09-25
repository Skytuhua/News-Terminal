use news_terminal_lib::{db::Database, Backend};
use serde_json::{json, Value};

fn setup() -> (Backend, Value, String) {
    let mut db = Database::memory().unwrap();
    let now = chrono::Utc::now().timestamp();
    let source = db.request(&json!({"op":"source_add","name":"Explicitly authorized synthetic test","url":"https://example.org/sector-test-feed","termsUrl":"https://example.org/test-terms","topics":["science"],"language":"en","region":"world","kind":"reporting","storage":"excerpt","aiAllowed":true}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[
        {"title":"Synthetic library opens with 1200 books","url":"https://example.org/library","excerpt":"Synthetic public-domain test material. Pinebridge opened a free library with 1200 books.","publishedAt":now-10},
        {"title":"Synthetic observatory adds telescope","url":"https://example.org/observatory","excerpt":"Synthetic public-domain test material. The observatory added a telescope for free public viewing.","publishedAt":now-20}
    ]}), now).unwrap();
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    (Backend::new(db), source, date)
}

#[tokio::test]
#[ignore = "Requires actual local Qwen on port 11434; synthetic public-domain inputs, not news"]
async fn actual_local_qwen_combines_explicitly_authorized_synthetic_inputs() {
    let (host, _, date) = setup();
    host.execute(json!({"op":"local_ai_connect"}))
        .await
        .unwrap();
    let preview = host.execute(json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"})).await.unwrap();
    let result = host.execute(json!({"op":"sector_summarize","profileId":"default","date":date,"sectorId":"science","fingerprint":preview["fingerprint"],"requestId":"actual-local-sector-synthetic"})).await.unwrap();
    assert_eq!(result["provider"], "ollama");
    assert_eq!(result["model"], "qwen3:4b-instruct-2507-q4_K_M");
    assert_eq!(result["sources"].as_array().unwrap().len(), 2);
    assert!(!result["bullets"].as_array().unwrap().is_empty());
    for bullet in result["bullets"].as_array().unwrap() {
        assert!(!bullet["citations"].as_array().unwrap().is_empty());
        for citation in bullet["citations"].as_array().unwrap() {
            assert!(result["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["id"] == *citation));
        }
    }
    println!(
        "ACTUAL_LOCAL_QWEN_SECTOR_SYNTHETIC_INPUT_UNVERIFIED {}",
        result
    );
}

#[tokio::test]
#[ignore = "Requires existing local Qwen; replays retained real NHC inputs without fetching or modifying them"]
async fn actual_local_qwen_retained_government_inputs() {
    let capture: Value =
        serde_json::from_str(include_str!("sector/fixtures/native-r5.json")).unwrap();
    // Reopen a read-only SQLite backup of the retained native smoke database,
    // including its private parser receipts. Never manufacture authorization by
    // importing article JSON or changing source rights; never use production data.
    let retained = std::env::var("NEWS_TERMINAL_RETAINED_SECTOR_DB").expect(
        "Set NEWS_TERMINAL_RETAINED_SECTOR_DB to the native smoke's retained temporary database",
    );
    let dir = tempfile::tempdir().unwrap();
    let replay = dir.path().join("retained-sector.sqlite3");
    let source = rusqlite::Connection::open_with_flags(
        &retained,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    source.backup("main", &replay, None).unwrap();
    drop(source);
    let db = Database::open(&replay).unwrap();
    let originals = capture["originalInputs"].as_array().unwrap();
    assert!(originals.iter().all(|a| a["sourceId"] == "nhc-atlantic"));
    assert!(db
        .list("provider", "")
        .unwrap()
        .iter()
        .all(|p| p["id"] == "ollama" || p["enabled"] != true || p["consented"] != true));
    let host = Backend::new(db);
    host.execute(json!({"op":"local_ai_connect"}))
        .await
        .unwrap();
    let date = &capture["preview"]["date"];
    let preview = host.execute(json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"weather"})).await.unwrap();
    assert_eq!(
        preview["selectedCount"], 2,
        "retained dates must qualify without date edits"
    );
    for original in originals {
        let selected = preview["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["articleId"] == original["id"])
            .unwrap();
        assert_eq!(selected["title"], original["title"]);
        assert_eq!(selected["publishedAt"], original["publishedAt"]);
        assert_eq!(selected["url"], original["url"]);
        let current = host
            .database()
            .unwrap()
            .article("default", original["id"].as_str().unwrap())
            .unwrap();
        assert_eq!(current["excerpt"], original["excerpt"]);
    }
    let backup_before = host.database().unwrap().export().unwrap();
    let result = host.execute(json!({"op":"sector_summarize","profileId":"default","date":date,"sectorId":"weather","fingerprint":preview["fingerprint"],"requestId":"actual-local-sector-retained"})).await;
    println!(
        "ACTUAL_LOCAL_QWEN_RETAINED_GROUNDING {}",
        json!({"fixtureProvenance":capture["provenance"],"preview":preview,"result":result,"semanticEntailmentVerified":false})
    );
    match &result {
        Ok(output) => {
            assert_eq!(output["provider"], "ollama");
            assert_eq!(output["model"], "qwen3:4b-instruct-2507-q4_K_M");
            for bullet in output["bullets"].as_array().unwrap() {
                assert_eq!(bullet["text"], bullet["evidence"][0]["quote"]);
                let id = &bullet["citations"][0];
                assert_eq!(bullet["evidence"][0]["sourceId"], *id);
                let source = output["sources"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|s| s["id"] == *id)
                    .unwrap();
                let input = originals
                    .iter()
                    .find(|a| a["id"] == source["articleId"])
                    .unwrap();
                let text = bullet["text"].as_str().unwrap();
                assert!(["title", "excerpt"]
                    .iter()
                    .any(|field| input[*field].as_str().unwrap().contains(text)));
            }
        }
        Err(error) => assert!(
            error.contains("Invalid sector synthesis"),
            "not a fail-closed validation outcome: {error}"
        ),
    }
    assert_eq!(host.database().unwrap().export().unwrap(), backup_before);
}

#[tokio::test]
async fn sector_api_uses_existing_consent_aware_provider_transport() {
    let (host, _, date) = setup();
    host.execute(json!({"op":"provider_save","provider":{"id":"ollama","kind":"ollama","name":"Invalid model test","model":"..","enabled":true,"consented":true}})).await.unwrap();
    let preview = host.execute(json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"})).await.unwrap();
    let error = host.execute(json!({"op":"sector_summarize","profileId":"default","date":date,"sectorId":"science","fingerprint":preview["fingerprint"],"requestId":"transport-test"})).await.unwrap_err();
    assert!(
        error.contains("Invalid model identifier"),
        "wrong transport error: {error}"
    );
}

#[tokio::test]
async fn sector_preview_excludes_unauthorized_hidden_undated_wrong_day_and_disabled_inputs() {
    let (host, source, date) = setup();
    let now = chrono::Utc::now().timestamp();
    {
        let mut db = host.database().unwrap();
        db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[
            {"title":"Undated fixture","url":"https://example.org/undated","excerpt":"Undated fixture"},
            {"title":"Old fixture","url":"https://example.org/old","excerpt":"Old fixture","publishedAt":now-172800}
        ]}), now).unwrap();
        let other = db.request(&json!({"op":"source_add","name":"No AI rights","url":"https://example.org/denied-feed","termsUrl":"https://example.org/terms","topics":["science"],"language":"en","region":"world","kind":"reporting","storage":"excerpt","aiAllowed":false}),now).unwrap();
        db.ingest(other["id"].as_str().unwrap(), &json!({"articles":[{"title":"Unlicensed fixture","url":"https://example.org/denied","excerpt":"MUST_NOT_BE_DISCLOSED","publishedAt":now-5}]}), now).unwrap();
    }
    let request = json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"});
    let preview = host.execute(request.clone()).await.unwrap();
    assert_eq!(preview["selectedCount"], 2);
    assert_eq!(preview["excludedCount"], 1);
    assert!(!preview.to_string().contains("MUST_NOT_BE_DISCLOSED"));
    let token = host.execute(json!({"op":"snapshot"})).await.unwrap()["replacementToken"].clone();
    host.execute(json!({"op":"article_state","profileId":"default","articleId":preview["sources"][0]["articleId"],"hidden":true,"saved":true,"replacementToken":token})).await.unwrap();
    assert_eq!(
        host.execute(request.clone()).await.unwrap()["selectedCount"],
        1
    );
    host.execute(json!({"op":"source_update","sourceId":source["id"],"enabled":false}))
        .await
        .unwrap();
    assert_eq!(
        host.execute(request.clone()).await.unwrap()["selectedCount"],
        0
    );
    for field in ["date", "profileId", "sectorId"] {
        let mut bad = request.clone();
        bad[field] = json!("invalid");
        assert!(host.execute(bad).await.is_err());
    }
}

#[tokio::test]
async fn sector_preview_caps_displayed_representatives_and_invalidates_other_contexts() {
    let (host, source, date) = setup();
    let now = chrono::Utc::now().timestamp();
    let articles:Vec<Value> = (0..20).map(|n|json!({"title":format!("Synthetic distinct event number {n}"),"url":format!("https://example.org/event-{n}"),"excerpt":"Permitted synthetic test text.","publishedAt":now-100-n})).collect();
    host.database()
        .unwrap()
        .ingest(
            source["id"].as_str().unwrap(),
            &json!({"articles":articles}),
            now,
        )
        .unwrap();
    let request = json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"});
    let preview = host.execute(request.clone()).await.unwrap();
    assert_eq!(preview["selectedCount"], 12);
    assert_eq!(preview["sources"].as_array().unwrap().len(), 12);
    assert!(preview["coverageLabel"]
        .as_str()
        .unwrap()
        .contains("22 retained"));
    let profile = host
        .execute(json!({"op":"profile_create","name":"Other context"}))
        .await
        .unwrap();
    for (field, value) in [
        ("profileId", profile["id"].clone()),
        ("date", json!("2024-01-01")),
        ("sectorId", json!("sports")),
    ] {
        let mut stale = request.clone();
        stale["op"] = json!("sector_summarize");
        stale[field] = value;
        stale["fingerprint"] = preview["fingerprint"].clone();
        stale["requestId"] = json!("stale-context");
        assert!(host.execute(stale).await.unwrap_err().contains("changed"));
    }
}

#[tokio::test]
async fn synthesis_requires_two_inputs_and_checks_preview_before_any_provider() {
    let (host, _, date) = setup();
    let mut request = json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"});
    let preview = host.execute(request.clone()).await.unwrap();
    request["op"] = json!("sector_summarize");
    request["requestId"] = json!("sector-test");
    request["fingerprint"] = preview["fingerprint"].clone();
    assert!(host
        .execute(request.clone())
        .await
        .unwrap_err()
        .contains("No enabled, consented"));
    request["fingerprint"] = json!("a".repeat(64));
    assert!(host
        .execute(request.clone())
        .await
        .unwrap_err()
        .contains("changed"));
    request["op"] = json!("sector_summary_preview");
    request["sectorId"] = json!("sports");
    let empty = host.execute(request.clone()).await.unwrap();
    request["op"] = json!("sector_summarize");
    request["fingerprint"] = empty["fingerprint"].clone();
    assert!(host.execute(request).await.unwrap_err().contains("two"));
}

#[tokio::test]
async fn preview_selects_authorized_current_sector_without_provider_or_excerpt_disclosure() {
    let (host, _, date) = setup();
    let request = json!({"op":"sector_summary_preview","profileId":"default","date":date,"sectorId":"science"});
    let preview = host
        .execute(request.clone())
        .await
        .expect("sector preview must exist");
    assert_eq!(preview["selectedCount"], 2);
    assert_eq!(preview["eligibleCount"], 2);
    assert_eq!(preview["excludedCount"], 0);
    assert_eq!(preview["limit"], 12);
    assert_eq!(preview["sources"][0]["id"], "S1");
    assert_eq!(preview["sources"][1]["id"], "S2");
    assert_eq!(preview["sectorTitle"], "Science");
    assert!(preview["sources"][0].get("excerpt").is_none());
    assert_eq!(preview["fingerprint"].as_str().unwrap().len(), 64);
    assert_eq!(host.execute(request).await.unwrap(), preview);
}
