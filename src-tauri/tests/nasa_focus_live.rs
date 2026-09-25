use base64::Engine;
use news_terminal_lib::{db::Database, rights, Backend};
use serde_json::json;
use sha2::{Digest, Sha256};

/// Bounded search audit, not a claim that focused-publisher coverage passes.
/// Uses the real feed, compiled rights, private provenance and production loader.
#[tokio::test]
#[ignore = "Explicit live NASA RSS classification audit and approved image download"]
async fn nasa_focus_live_production_audit() {
    tokio::time::timeout(std::time::Duration::from_secs(100), async {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("nasa-focus-audit.sqlite3")).unwrap();
        let now = chrono::Utc::now().timestamp();
        for source in db.list("source", "").unwrap() {
            db.request(&json!({"op":"source_update", "sourceId":source["id"], "enabled":source["id"] == "nasa-technology"}), now).unwrap();
        }
        let source = rights::bundled("nasa-technology").unwrap();
        assert!(source.get("sectionScope").is_none());
        assert_eq!(source["aiAllowed"], false);
        let host = Backend::new(db);
        let refreshed = host.execute(json!({"op":"refresh"})).await.unwrap();
        assert_eq!(refreshed["failed"], 0, "{refreshed}");
        let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
        let articles = snapshot["articles"].as_array().unwrap();
        assert!(!articles.is_empty());
        let mut focused = 0;
        let mut images_loaded = 0;
        let mut lunar_loaded = false;
        let mut urls = std::collections::HashSet::new();
        for article in articles {
            assert!(urls.insert(article["url"].as_str().unwrap()));
            let lunar = article["url"] == "https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/";
            if lunar {
                assert_eq!(article["sections"], json!(["technology"]));
                assert_eq!(article["classificationVersion"], 2);
                assert_eq!(article["media"].as_array().unwrap().len(), 1);
            }
            if article["url"].as_str().unwrap().contains("nasa-celebrates-restoration-of-guam-station") {
                assert_eq!(article["sections"], json!(["others"]), "Guam must not be relabeled merely to pass image coverage");
            }
            assert_eq!(article["sourceId"], "nasa-technology");
            let sections = article["sections"].as_array().unwrap();
            if sections.iter().any(|s| s == "ai" || s == "technology" || s == "stocks") {
                focused += 1;
            }
            println!("NASA_FOCUS_ITEM {}", json!({"title":article["title"], "url":article["url"], "excerpt":article["excerpt"], "sections":article["sections"], "reasons":article["classificationReasons"], "media":article["media"]}));
            for (index, media) in article["media"].as_array().into_iter().flatten().enumerate() {
                let approval = host.database().unwrap().authorize_media(article, media).unwrap().unwrap();
                assert!(source["rightsPolicy"]["mediaAllowlist"].as_array().unwrap().contains(&approval));
                if media["kind"] != "image" { continue; }
                let result = host.execute(json!({"op":"media_load", "profileId":"default", "replacementToken":snapshot["replacementToken"], "automatic":false, "articleId":article["id"], "index":index})).await.unwrap();
                let bytes = base64::engine::general_purpose::STANDARD.decode(result["dataUrl"].as_str().unwrap().split_once(',').unwrap().1).unwrap();
                let preview = image::load_from_memory(&bytes).unwrap();
                assert_eq!(result["bytes"], bytes.len());
                assert_eq!(result["mimeType"], "image/png");
                assert!(host.database().unwrap().authorize_ai(article).is_err());
                println!("NASA_FOCUS_MEDIA {}", json!({"article":article["url"], "originalPinBytes":approval["bytes"], "originalPinSha256":approval["sha256"], "previewBytes":bytes.len(), "previewSha256":format!("{:x}", Sha256::digest(&bytes)), "previewDimensions":[preview.width(),preview.height()]}));
                images_loaded += 1;
                lunar_loaded |= lunar;
            }
        }
        assert!(lunar_loaded, "reviewed lunar concept absent or not loaded; live focused-media gate is blocked, do not widen policy");
        assert!(images_loaded > 0, "approved images rotated out; inspect current feed without widening policy");
        println!("NASA_FOCUS_TOTAL {}", json!({"items":articles.len(), "focusedItems":focused, "approvedImagesLoaded":images_loaded}));
    }).await.expect("bounded NASA focus audit timed out");
}
