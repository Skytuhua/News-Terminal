use super::*;

fn compatible_provider() -> Value {
    json!({"id":"openai-local","kind":"openai-local","name":"Local OpenAI-compatible",
        "baseUrl":"http://localhost:1234/v1/","model":"org/local-model@q4_k_m",
        "enabled":true,"consented":true})
}

fn save(database: &mut Database, provider: Value) -> Result<Value> {
    database.request(
        &json!({"op":"provider_save","provider":provider}),
        1_792_281_600,
    )
}

#[test]
fn compatible_provider_is_optional_until_explicitly_saved_and_has_no_exported_keys() {
    let mut database = Database::memory().unwrap();
    let initial = database.list("provider", "").unwrap();
    assert_eq!(initial.len(), 3);
    assert!(initial
        .iter()
        .all(|p| p["enabled"] == false && p["consented"] == false));
    assert!(initial.iter().all(|p| p["kind"] != "openai-local"));
    let mut provider = compatible_provider();
    provider["apiKey"] = json!("DO_NOT_EXPORT_LOCAL_KEY");
    provider["hasKey"] = json!(true);
    save(&mut database, provider).unwrap();
    let stored = database
        .get("provider", "openai-local", "")
        .unwrap()
        .unwrap();
    assert_eq!(stored["baseUrl"], "http://127.0.0.1:1234/v1");
    assert!(stored.get("apiKey").is_none());
    assert!(stored.get("hasKey").is_none());
    assert_eq!(stored["consented"], true);
    let backup = database.export().unwrap();
    assert!(!backup.contains("DO_NOT_EXPORT_LOCAL_KEY"));
    assert!(!backup.contains("hasKey"));
    let mut restored = Database::memory().unwrap();
    restored.import(&backup).unwrap();
    let providers = restored.list("provider", "").unwrap();
    assert_eq!(providers.len(), 4);
    assert!(providers
        .iter()
        .all(|p| p["enabled"] == false && p["consented"] == false));
    assert_eq!(
        restored
            .get("provider", "openai-local", "")
            .unwrap()
            .unwrap()["baseUrl"],
        "http://127.0.0.1:1234/v1"
    );
}

#[test]
fn legacy_backup_still_imports_and_does_not_retain_new_provider_consent() {
    let legacy = Database::memory().unwrap().export().unwrap();
    let mut database = Database::memory().unwrap();
    save(&mut database, compatible_provider()).unwrap();
    database.import(&legacy).unwrap();
    assert!(database
        .get("provider", "openai-local", "")
        .unwrap()
        .is_none());
    assert!(database
        .list("provider", "")
        .unwrap()
        .iter()
        .all(|p| p["enabled"] == false && p["consented"] == false));
    assert!(database.export().is_ok());
}

#[test]
fn invalid_compatible_settings_and_backups_are_rejected_atomically() {
    let mut database = Database::memory().unwrap();
    save(&mut database, compatible_provider()).unwrap();
    let before = database.export().unwrap();
    for (field, invalid) in [
        ("baseUrl", json!("https://api.openai.com/v1")),
        ("baseUrl", json!("http://192.168.0.1:1234/v1")),
        (
            "baseUrl",
            json!("http://user:PRIVATE_KEY@127.0.0.1:1234/v1"),
        ),
        (
            "baseUrl",
            json!("http://127.0.0.1:1234/v1?api_key=PRIVATE_KEY"),
        ),
        ("baseUrl", Value::Null),
        ("model", json!("")),
        ("model", json!("model\nInjected")),
        ("model", json!("x".repeat(201))),
        ("consented", json!("true")),
        ("enabled", json!(1)),
        ("id", json!("custom-provider")),
    ] {
        let mut provider = compatible_provider();
        provider[field] = invalid.clone();
        assert!(save(&mut database, provider).is_err());
        assert_eq!(database.export().unwrap(), before);
        let mut backup: Value = serde_json::from_str(&before).unwrap();
        let entry = backup["documents"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| d["kind"] == "provider" && d["id"] == "openai-local")
            .unwrap();
        entry["data"][field] = invalid;
        let error = database.import(&backup.to_string()).unwrap_err();
        assert!(!error.contains("PRIVATE_KEY"));
        assert_eq!(database.export().unwrap(), before);
    }
}

#[test]
fn compatible_backup_rejects_credentials_and_preserves_required_legacy_records() {
    let mut database = Database::memory().unwrap();
    save(&mut database, compatible_provider()).unwrap();
    let raw = database.export().unwrap();
    for field in ["apiKey", "hasKey", "authorization", "headers"] {
        let mut backup: Value = serde_json::from_str(&raw).unwrap();
        let entry = backup["documents"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| d["id"] == "openai-local" && d["kind"] == "provider")
            .unwrap();
        entry["data"][field] = json!("PRIVATE_KEY");
        assert!(database.import(&backup.to_string()).is_err());
    }
    let mut missing: Value = serde_json::from_str(&raw).unwrap();
    missing["documents"]
        .as_array_mut()
        .unwrap()
        .retain(|d| !(d["id"] == "ollama" && d["kind"] == "provider"));
    assert!(database.import(&missing.to_string()).is_err());
    let mut legacy = json!({"id":"ollama","kind":"ollama","name":"Ollama","model":"local",
        "enabled":false,"consented":false});
    legacy["baseUrl"] = json!("http://127.0.0.1:1234/v1");
    assert!(validate_provider(&legacy).is_err());
    assert_eq!(database.export().unwrap(), raw);
}
