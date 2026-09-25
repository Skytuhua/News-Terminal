use news_terminal_lib::{db::Database, Backend};
use serde_json::json;

#[tokio::test]
#[ignore = "Explicit live, keyless metadata reads; not a deterministic CI test"]
async fn live_metadata_backend_dispatch_and_persistent_cache() {
    let dir = std::env::temp_dir().join(format!("news-metadata-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("metadata.sqlite3");
    let host = Backend::new(Database::open(&path).unwrap());
    let (models, benchmarks) = tokio::join!(
        host.execute(json!({"op":"model_catalog"})),
        host.execute(json!({"op":"benchmark_catalog"}))
    );
    let models = models.unwrap();
    let benchmarks = benchmarks.unwrap();
    println!(
        "OpenRouter status={} count={} error={}",
        models["status"], models["totalCount"], models["error"]
    );
    println!(
        "Hugging Face status={} count={} error={}",
        models["huggingFace"]["status"],
        models["huggingFace"]["totalCount"],
        models["huggingFace"]["error"]
    );
    for panel in benchmarks["panels"].as_array().unwrap() {
        println!(
            "{} status={} count={} error={}",
            panel["source"], panel["status"], panel["totalCount"], panel["error"]
        );
        assert_eq!(panel["status"], "fresh");
        assert_eq!(panel["complete"], true);
        assert_eq!(
            panel["totalCount"].as_u64().unwrap() as usize,
            panel["rows"].as_array().unwrap().len()
        );
        println!("sample={}", panel["rows"][0]);
    }
    assert_eq!(models["status"], "fresh");
    assert_eq!(models["huggingFace"]["status"], "fresh");
    assert_eq!(
        models["totalCount"].as_u64().unwrap() as usize,
        models["models"].as_array().unwrap().len()
    );
    assert!(models["changes"].as_array().unwrap().is_empty());
    assert_eq!(
        host.execute(json!({"op":"model_catalog"})).await.unwrap(),
        models
    );
    drop(host);
    let restarted = Backend::new(Database::open(&path).unwrap());
    assert_eq!(
        restarted
            .execute(json!({"op":"model_catalog"}))
            .await
            .unwrap(),
        models
    );
    assert_eq!(
        restarted
            .execute(json!({"op":"benchmark_catalog"}))
            .await
            .unwrap(),
        benchmarks
    );
    println!("Restart: exact persisted source snapshots returned within TTL");
    drop(restarted);
    std::fs::remove_dir_all(dir).unwrap();
}
