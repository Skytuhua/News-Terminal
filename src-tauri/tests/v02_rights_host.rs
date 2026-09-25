use news_terminal_lib::{db::Database, Backend};
use serde_json::{json, Value};

fn custom_database() -> (Database, Value, Value) {
    let mut db = Database::memory().unwrap();
    let now = chrono::Utc::now().timestamp();
    let source = db.request(&json!({"op":"source_add","name":"Rights host synthetic test","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt","aiAllowed":true,"mediaAllowed":true}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Synthetic rights test","url":"https://example.org/story","excerpt":"Synthetic permitted text","media":[{"kind":"image","url":"https://example.org/image.png","mimeType":"image/png","playback":"inline"}]}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    (db, source, article)
}

fn live_host(only: &[&str]) -> (tempfile::TempDir, Backend) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("live-rights.sqlite3")).unwrap();
    for source in db.list("source", "").unwrap() {
        db.request(&json!({"op":"source_update","sourceId":source["id"],"enabled":only.contains(&source["id"].as_str().unwrap())}), chrono::Utc::now().timestamp()).unwrap();
    }
    (dir, Backend::new(db))
}

#[tokio::test]
#[ignore = "Explicit real NASA feed and byte-pinned asset downloads; no fixtures"]
async fn actual_authorized_host_nasa_media() {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    tokio::time::timeout(std::time::Duration::from_secs(100), async {
        let (_dir, host) = live_host(&["nasa-technology"]);
        let refreshed = host.execute(json!({"op":"refresh"})).await.unwrap();
        assert_eq!(refreshed["failed"], 0, "{refreshed}");
        let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
        let mut count = 0;
        for article in snapshot["articles"].as_array().unwrap() {
            for (index, item) in article["media"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let approval = host
                    .database()
                    .unwrap()
                    .authorize_media(article, item)
                    .unwrap()
                    .unwrap();
                let result = host
                    .execute(json!({"op":"media_load","articleId":article["id"],"index":index}))
                    .await
                    .unwrap();
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(
                        result["dataUrl"]
                            .as_str()
                            .unwrap()
                            .split_once(',')
                            .unwrap()
                            .1,
                    )
                    .unwrap();
                let hash = format!("{:x}", Sha256::digest(&bytes));
                assert_eq!(result["bytes"], approval["bytes"]);
                assert_eq!(hash, approval["sha256"].as_str().unwrap());
                assert_eq!(result["mimeType"], approval["mime"]);
                println!(
                    "ACTUAL_AUTHORIZED_HOST_NASA article={} asset={} kind={} bytes={} sha256={}",
                    article["url"], item["url"], result["kind"], result["bytes"], hash
                );
                count += 1;
            }
        }
        assert_eq!(
            count,
            news_terminal_lib::rights::bundled("nasa-technology").unwrap()["rightsPolicy"]
                ["mediaAllowlist"]
                .as_array()
                .unwrap()
                .len()
        );
    })
    .await
    .expect("bounded NASA host smoke timed out");
}

#[tokio::test]
#[ignore = "Explicit real government feeds and actual local Qwen; no fixtures"]
async fn actual_authorized_host_government_ai() {
    tokio::time::timeout(std::time::Duration::from_secs(180), async {
        let sources = ["nhc-atlantic", "fed-press_all", "fed-press_monetary"];
        let (_dir, host) = live_host(&sources);
        host.execute(json!({"op":"local_ai_connect"})).await.unwrap();
        let refreshed = host.execute(json!({"op":"refresh"})).await.unwrap();
        assert_eq!(refreshed["failed"], 0, "{refreshed}");
        let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
        for sid in sources {
            let article = snapshot["articles"].as_array().unwrap().iter().find(|a| a["sourceId"] == sid && host.database().unwrap().authorize_ai(a).is_ok()).unwrap_or_else(|| panic!("No currently authorized government input for {sid}"));
            let result = host.execute(json!({"op":"summarize","articleId":article["id"],"requestId":format!("actual-rights-{sid}")})).await.unwrap();
            let policy = &news_terminal_lib::rights::bundled(sid).unwrap()["rightsPolicy"];
            assert_eq!(result["provider"], "ollama");
            assert_eq!(result["model"], "qwen3:4b-instruct-2507-q4_K_M");
            assert_eq!(result["scope"], "feed excerpt");
            assert_eq!(result["attribution"], policy["attribution"]);
            assert_eq!(result["outputLabel"], policy["outputLabel"]);
            assert!(!result["text"].as_str().unwrap().is_empty());
            if sid.starts_with("fed-") { assert!(result["inputLabel"].as_str().unwrap().contains("Headline-only")); }
            println!("ACTUAL_AUTHORIZED_HOST_GOVERNMENT {sid} {result}");
        }
    }).await.expect("bounded government host smoke timed out");
}

#[tokio::test]
async fn forged_bundled_true_flags_cannot_replace_private_provenance() {
    for sid in ["nhc-atlantic", "fed-press_all", "fed-press_monetary"] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rights.sqlite3");
        let mut db = Database::open(&path).unwrap();
        let now = chrono::Utc::now().timestamp();
        db.ingest(sid, &json!({"articles":[{"title":"Forged authorization test","url":"https://example.org/forged","excerpt":"This is synthetic unapproved text","aiAllowed":true}]}), now).unwrap();
        let mut article =
            db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
        // Simulate a legacy/corrupt row with true flags, without manufacturing a
        // private parser receipt. UI/import true flags alone are insufficient too.
        article["aiAllowed"] = json!(true);
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE articles SET data=?1 WHERE id=?2",
                rusqlite::params![article.to_string(), article["id"].as_str().unwrap()],
            )
            .unwrap();
        let host = Backend::new(db);
        let error = host.execute(json!({"op":"summarize","articleId":article["id"],"requestId":sid,"aiAllowed":true})).await.unwrap_err();
        assert!(
            error.contains("provenance"),
            "{sid}: forged true flags reached providers: {error}"
        );
    }
}

#[tokio::test]
async fn disabled_attested_source_never_reaches_ai_provider() {
    let (mut db, source, article) = custom_database();
    db.request(
        &json!({"op":"source_update","sourceId":source["id"],"enabled":false}),
        chrono::Utc::now().timestamp(),
    )
    .unwrap();
    let host = Backend::new(db);
    let error = host
        .execute(json!({"op":"summarize","articleId":article["id"],"requestId":"disabled"}))
        .await
        .unwrap_err();
    assert!(error.contains("disabled"), "{error}");
}

#[tokio::test]
async fn imported_custom_ai_requires_private_receipt_before_provider_selection() {
    let (db, _, article) = custom_database();
    let backup = db.export().unwrap();
    let host = Backend::new(db);
    host.execute(json!({"op":"import","data":backup}))
        .await
        .unwrap();
    let error = host.execute(json!({"op":"summarize","articleId":article["id"],"requestId":"unattested","aiAllowed":true})).await.unwrap_err();
    assert!(
        error.contains("confirmed after import"),
        "rights check must precede provider selection: {error}"
    );
}
