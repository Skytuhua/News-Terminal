use base64::Engine;
use image::GenericImageView;
use news_terminal_lib::{db::Database, rights, Backend};
use serde_json::json;
use sha2::{Digest, Sha256};

/// No fixture transport, custom source, forged receipt or persistent user DB.
#[tokio::test]
#[ignore = "Explicit live FEDS Notes RSS and exact PNG through production Backend media_load"]
async fn fed_diagram_live_production_backend() {
    tokio::time::timeout(std::time::Duration::from_secs(90), async {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("fed-diagram-live.sqlite3")).unwrap();
        let now = chrono::Utc::now().timestamp();
        for source in db.list("source", "").unwrap() {
            db.request(&json!({"op":"source_update", "sourceId":source["id"], "enabled":source["id"] == "fed-feds-notes"}), now).unwrap();
        }
        let host = Backend::new(db);
        let refreshed = host.execute(json!({"op":"refresh"})).await.unwrap();
        assert_eq!(refreshed["failed"], 0, "{refreshed}");
        let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
        let approval = &rights::bundled("fed-feds-notes").unwrap()["rightsPolicy"]["mediaAllowlist"][0];
        let articles = snapshot["articles"].as_array().unwrap();
        let article = articles.iter().find(|a| a["url"] == approval["itemUrl"])
            .expect("reviewed live RSS item rotated out or no longer supplied");
        assert_eq!(article["sections"], json!(["stocks"]));
        assert_eq!(article["classificationReasons"], json!(["Headline/excerpt contains stock or market terminology"]));
        assert_eq!(article["media"].as_array().unwrap().len(), 1);
        assert!(articles.iter().filter(|a| a["url"] != approval["itemUrl"]).all(|a| a.get("media").is_none() && a["excerpt"] == ""));
        assert_eq!(host.database().unwrap().authorize_media(article, &article["media"][0]).unwrap().as_ref(), Some(approval));
        let result = host.execute(json!({"op":"media_load", "profileId":"default", "replacementToken":snapshot["replacementToken"], "automatic":false, "articleId":article["id"], "index":0})).await.unwrap();
        assert_eq!(result["mimeType"], "image/png");
        let bytes = base64::engine::general_purpose::STANDARD.decode(result["dataUrl"].as_str().unwrap().split_once(',').unwrap().1).unwrap();
        let preview = image::load_from_memory(&bytes).unwrap();
        // Native decoder resizes proportionally, never crops. Original is 1221x471.
        let (width, height) = preview.dimensions();
        assert!((width as f64 / height as f64 - 1221.0 / 471.0).abs() < 0.02);
        assert_eq!(result["bytes"], bytes.len());
        assert!(host.database().unwrap().authorize_ai(article).is_err());
        println!("FED_DIAGRAM_LIVE article={} source={} sections={} original_pin_bytes={} original_pin_sha256={} preview_bytes={} preview_sha256={:x} preview_dimensions={}x{} feed_items={}",
            article["url"], article["sourceId"], article["sections"], approval["bytes"], approval["sha256"], bytes.len(), Sha256::digest(&bytes), width, height, articles.len());
    }).await.expect("bounded live Fed diagram smoke timed out");
}
