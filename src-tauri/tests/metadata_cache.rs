use news_terminal_lib::models::MetadataCache;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn cache_coalesces_then_retains_stale_last_good_and_backs_off() {
    let cache = MetadataCache::default();
    let calls = AtomicUsize::new(0);
    let loader = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(json!({"complete":true,"observedAt":100,"rows":[{"value":null}]}))
    };
    let (a, b) = tokio::join!(
        cache.load(None, 100, 3600, loader),
        cache.load(None, 100, 3600, loader)
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(a, b);
    assert_eq!(a["status"], "fresh");
    let failed = cache
        .load(None, 3701, 3600, || async { Err("HTTP 503".into()) })
        .await;
    assert_eq!(failed["status"], "stale");
    assert_eq!(failed["observedAt"], 100);
    assert_eq!(failed["rows"], a["rows"]);
    assert_eq!(failed["lastChecked"], 3701);
    let backed_off = cache.load(None, 3702, 3600, loader).await;
    assert_eq!(backed_off, failed);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let restarted = MetadataCache::default();
    assert_eq!(
        restarted
            .load(Some(failed.clone()), 3702, 3600, loader)
            .await,
        failed
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let bad = cache
        .load(None, 4002, 3600, || async {
            Ok(json!({"complete":false,"rows":[]}))
        })
        .await;
    assert_eq!(bad["rows"], a["rows"]);
    assert_eq!(bad["status"], "stale");
}
#[tokio::test]
async fn independent_cache_failure_does_not_discard_other_source() {
    let a = MetadataCache::default();
    let b = MetadataCache::default();
    let (failed, good) = tokio::join!(
        a.load(None, 100, 86400, || async { Err("offline".into()) }),
        b.load(None, 100, 86400, || async {
            Ok(json!({"complete":true,"observedAt":100,"rows":[{"value":79.2}]}))
        })
    );
    assert_eq!(failed["status"], "unavailable");
    assert_eq!(good["status"], "fresh");
    assert_eq!(good["rows"][0]["value"], 79.2);
}
#[test]
fn persistent_cache_is_bounded_separate_and_not_exported() {
    let db = news_terminal_lib::db::Database::memory().unwrap();
    assert!(db.metadata_cache_get("arena").unwrap().is_none());
    let snapshot =
        json!({"complete":true,"observedAt":100,"rows":[{"model":"metadata-only-export-marker"}]});
    db.metadata_cache_put("arena", &snapshot).unwrap();
    assert!(!db.export().unwrap().contains("metadata-only-export-marker"));
    assert_eq!(db.metadata_cache_get("arena").unwrap(), Some(snapshot));
    assert!(db.metadata_cache_put("unknown", &Value::Null).is_err());
    assert!(db
        .metadata_cache_put("arena", &json!({"complete":false}))
        .is_err());
}
