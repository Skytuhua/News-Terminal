use super::*;
use crate::rights;

#[tokio::test]
#[ignore = "explicit live government feeds, local Ollama and pinned NASA downloads"]
async fn rights_live_database_ai_and_pinned_media() {
    let mut db = Database::memory().unwrap();
    let now = chrono::Utc::now().timestamp();
    for id in [
        "nhc-atlantic",
        "fed-press_monetary",
        "fed-press_all",
        "nasa-technology",
    ] {
        let source = rights::bundled(id).unwrap();
        db.put("source", id, "", source).unwrap();
        let feed = crate::services::fetch_feed(source).await.unwrap();
        db.ingest(id, &feed, now).unwrap();
        let articles: Vec<_> = db
            .articles("default", None)
            .unwrap()
            .into_iter()
            .filter(|a| a["sourceId"] == id)
            .collect();
        let eligible: Vec<_> = articles
            .iter()
            .filter(|a| db.authorize_ai(a).is_ok())
            .collect();
        println!(
            "LIVE DB {id}: retained={} eligible={}",
            articles.len(),
            eligible.len()
        );
        if id != "nasa-technology" {
            assert!(!eligible.is_empty());
            let a = eligible[0];
            let providers = vec![
                json!({"id":"ollama","kind":"ollama","enabled":true,"consented":true,"model":"qwen3:4b-instruct-2507-q4_K_M"}),
            ];
            let summary = crate::services::summarize(
                &providers,
                a,
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            )
            .await
            .unwrap();
            db.authorize_ai(a).unwrap();
            assert!(!summary["text"].as_str().unwrap().is_empty());
            println!(
                "LIVE SUMMARY {id}: model={} article={} text={}",
                summary["model"], a["url"], summary["text"]
            );
        } else {
            let mut count = 0;
            for a in &articles {
                for item in a["media"].as_array().into_iter().flatten() {
                    let approval = db.authorize_media(a, item).unwrap();
                    let result = crate::media::load_authorized_media(item, approval.as_ref())
                        .await
                        .unwrap();
                    println!(
                        "LIVE PINNED NASA kind={} mime={} bytes={} hash={}",
                        result["kind"],
                        result["mimeType"],
                        result["bytes"],
                        approval.unwrap()["sha256"]
                    );
                    count += 1;
                }
            }
            assert_eq!(count, 2);
        }
    }
}

#[test]
fn rights_import_reconciles_stricter_storage_and_stays_restorable() {
    let mut db = Database::memory().unwrap();
    let mut src = rights::bundled("bbc-world").unwrap().clone();
    src["storage"] = json!("excerpt");
    src["enabled"] = json!(true);
    src["aiAllowed"] = json!(true);
    db.put("source", "bbc-world", "", &src).unwrap();
    db.ingest("bbc-world",&json!({"articles":[{"title":"Imported headline","excerpt":"Uncleared body","url":"https://www.bbc.com/news/example"}]}),1800000000).unwrap();
    let raw = db.export().unwrap();
    db.import(&raw).unwrap();
    assert_eq!(db.articles("default", None).unwrap()[0]["excerpt"], "");
    db.export().unwrap();
}

#[test]
fn rights_imported_custom_grants_need_explicit_separate_reattestation() {
    let mut db = Database::memory().unwrap();
    let src=db.request(&json!({"op":"source_add","name":"Custom","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"region":"world","language":"en","kind":"reporting","storage":"excerpt","aiAllowed":true,"mediaAllowed":true}),1).unwrap();
    let id = src["id"].as_str().unwrap();
    db.ingest(id,&json!({"articles":[{"title":"Custom test","url":"https://example.org/item","excerpt":"Custom supplied text","media":[{"kind":"image","url":"https://example.org/p.jpg","playback":"inline"}]}]}),1800000000).unwrap();
    let a = db.articles("default", None).unwrap().remove(0);
    db.authorize_ai(&a).unwrap();
    let backup = db.export().unwrap();
    db.import(&backup).unwrap();
    assert!(db.authorize_ai(&a).is_err());
    db.request(
        &json!({"op":"source_update","sourceId":id,"enabled":true}),
        1800000001,
    )
    .unwrap();
    assert!(db.authorize_ai(&a).is_err());
    assert!(db.authorize_media(&a, &a["media"][0]).is_err());
    db.request(
        &json!({"op":"source_update","sourceId":id,"mediaAllowed":true}),
        1800000002,
    )
    .unwrap();
    assert!(db.authorize_ai(&a).is_err());
    assert!(db.authorize_media(&a, &a["media"][0]).unwrap().is_none());
}

fn nasa_feed() -> Value {
    let s = rights::bundled("nasa-technology").unwrap();
    let asset = &s["rightsPolicy"]["mediaAllowlist"][0];
    let xml = format!(
        r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>NASA</title><link>https://www.nasa.gov</link><description>Feed</description><item><title>NASA Guam</title><guid isPermaLink="false">{}</guid><link>{}</link><description>Supplied excerpt</description><media:content url="{}" type="video/mp4"/></item></channel></rss>"#,
        asset["itemGuid"].as_str().unwrap(),
        asset["itemUrl"].as_str().unwrap(),
        asset["url"].as_str().unwrap()
    );
    crate::services::parse_feed(xml.as_bytes(), s).unwrap()
}
#[test]
fn rights_media_authorization_rechecks_private_guid_exact_asset_and_import_revocation() {
    nasa_media_authorization_case(nasa_feed());
}

#[test]
fn rights_lunar_png_private_proof_wrong_item_and_import_revocation() {
    let source = rights::bundled("nasa-technology").unwrap();
    let feed = crate::services::parse_feed(
        include_bytes!("../fixtures/nasa-lunar-technologies.xml"),
        source,
    )
    .unwrap();
    nasa_media_authorization_case(feed);
}

fn nasa_media_authorization_case(feed: Value) {
    let mut db = Database::memory().unwrap();
    db.put(
        "source",
        "nasa-technology",
        "",
        rights::bundled("nasa-technology").unwrap(),
    )
    .unwrap();
    db.ingest("nasa-technology", &feed, 1800000000).unwrap();
    let a = db.articles("default", None).unwrap().remove(0);
    let item = &a["media"][0];
    let grant = db.authorize_media(&a, item).unwrap().unwrap();
    let expected = rights::bundled("nasa-technology").unwrap()["rightsPolicy"]["mediaAllowlist"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pin| pin["url"] == item["url"])
        .unwrap();
    assert_eq!(&grant, expected);
    assert!(db.authorize_ai(&a).is_err());
    let mut wrong_item = a.clone();
    wrong_item["url"] = json!("https://www.nasa.gov/other-story/");
    assert!(db.authorize_media(&wrong_item, item).is_err());
    let mut changed = item.clone();
    changed["url"] = json!("https://www.nasa.gov/maxar.jpg");
    assert!(db.authorize_media(&a, &changed).is_err());
    let backup = db.export().unwrap();
    db.import(&backup).unwrap();
    assert!(db.authorize_media(&a, item).is_err());
    db.ingest("nasa-technology", &feed, 1800000001).unwrap();
    db.authorize_media(&a, item).unwrap();
    db.request(
        &json!({"op":"source_update","sourceId":"nasa-technology","mediaAllowed":false}),
        1800000002,
    )
    .unwrap();
    assert!(db.authorize_media(&a, item).is_err());
}

fn fed_feed() -> Value {
    let xml = br#"<rss version="2.0"><channel><title>Fed</title><link>https://www.federalreserve.gov</link><description>Feed</description><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260923a.htm</link><description>Federal Reserve issues FOMC statement</description><pubDate>Wed, 23 Sep 2026 15:00:00 GMT</pubDate></item></channel></rss>"#;
    crate::services::parse_feed(xml, rights::bundled("fed-press_monetary").unwrap()).unwrap()
}
#[test]
fn rights_authorization_is_private_input_bound_revoked_by_import_and_restored_on_refresh() {
    let mut db = Database::memory().unwrap();
    db.put(
        "source",
        "fed-press_monetary",
        "",
        rights::bundled("fed-press_monetary").unwrap(),
    )
    .unwrap();
    let feed = fed_feed();
    db.ingest("fed-press_monetary", &feed, 1800000000).unwrap();
    let a = db.articles("default", None).unwrap().remove(0);
    db.authorize_ai(&a).unwrap();
    let mut changed = a.clone();
    changed["excerpt"] = json!("Forged text");
    assert!(db.authorize_ai(&changed).is_err());
    let backup = db.export().unwrap();
    assert!(!backup.contains("_rights"));
    assert!(!backup.contains("rights_provenance"));
    db.import(&backup).unwrap();
    assert!(db.authorize_ai(&a).is_err());
    assert_eq!(
        db.article_raw(a["id"].as_str().unwrap()).unwrap().unwrap()["aiAllowed"],
        false
    );
    db.ingest("fed-press_monetary", &feed, 1800000010).unwrap();
    let fresh = db.article_raw(a["id"].as_str().unwrap()).unwrap().unwrap();
    db.authorize_ai(&fresh).unwrap();
    db.request(
        &json!({"op":"source_update","sourceId":"fed-press_monetary","enabled":false}),
        1800000020,
    )
    .unwrap();
    assert!(db.authorize_ai(&fresh).is_err());
}
#[test]
fn rights_import_cannot_replace_catalog_endpoint_policy_or_custom_attestation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("db")).unwrap();
    let mut backup: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    let docs = backup["documents"].as_array_mut().unwrap();
    let s = docs
        .iter_mut()
        .find(|d| d["id"] == "fed-press_monetary")
        .unwrap();
    s["data"]["url"] = json!("https://example.org/forged");
    db.import(&backup.to_string()).unwrap();
    let src = reviewed(&db, "fed-press_monetary");
    assert_eq!(src["aiAllowed"], false);
    assert_eq!(src["url"], "https://example.org/forged");
    let mut bad: Value = serde_json::from_str(&db.export().unwrap()).unwrap();
    bad["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["id"] == "nasa-technology")
        .unwrap()["data"]["rightsPolicy"]["mediaAllowlist"][0]["sha256"] = json!("xyz");
    assert!(db.import(&bad.to_string()).is_err());
}

fn reviewed(db: &Database, id: &str) -> Value {
    db.get("source", id, "").unwrap().unwrap()
}
#[test]
fn rights_no_raw_proof_means_no_bundled_ai_even_with_true_source_flag() {
    let mut db = Database::memory().unwrap();
    let s = rights::bundled("fed-press_monetary").unwrap();
    db.put("source", "fed-press_monetary", "", s).unwrap();
    db.ingest("fed-press_monetary", &json!({"articles":[{"title":"Federal Reserve issues FOMC statement","url":"https://www.federalreserve.gov/newsevents/pressreleases/monetary20260923a.htm","excerpt":"Federal Reserve issues FOMC statement","publishedAt":1790175600,"aiAllowed":true}]}), 1800000000).unwrap();
    assert_eq!(db.articles("default", None).unwrap()[0]["aiAllowed"], false);
}
#[test]
fn rights_migration_updates_v01_ceiling_preserves_preferences_and_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v01.db");
    let db = Database::open(&path).unwrap();
    let mut old = reviewed(&db, "fed-press_monetary");
    old.as_object_mut().unwrap().remove("rightsPolicy");
    old["aiAllowed"] = json!(false);
    old["enabled"] = json!(false);
    old["lastAttempt"] = json!(1790170000);
    db.put("source", "fed-press_monetary", "", &old).unwrap();
    db.conn
        .execute(
            "DELETE FROM documents WHERE kind='source' AND id='mastodon-official'",
            [],
        )
        .unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let current = reviewed(&db, "fed-press_monetary");
    assert_eq!(
        current["rightsPolicy"],
        rights::bundled("fed-press_monetary").unwrap()["rightsPolicy"]
    );
    assert_eq!(current["aiAllowed"], true);
    assert_eq!(current["enabled"], false);
    assert_eq!(current["lastAttempt"], old["lastAttempt"]);
    assert!(db.get("source", "mastodon-official", "").unwrap().is_some());
    let first = db.export().unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.export().unwrap(), first);
}
