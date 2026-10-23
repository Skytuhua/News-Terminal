use news_terminal_lib::db::Database;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};

#[test]
fn native_json_backup_preserves_history_over_32_mib_and_all_profile_states() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Fixture","url":"https://example.org/story","excerpt":"x".repeat(2000)}]}), now).unwrap();
    let mut article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    article["history"] = json!((0..3)
        .map(|i| json!({"at":now-i,"title":format!("Earlier {i}"),"excerpt":"x".repeat(2000)}))
        .collect::<Vec<_>>());
    for i in 0..10 {
        db.request(
            &json!({"op":"profile_create","name":format!("Profile {i}")}),
            now,
        )
        .unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<4999) INSERT INTO articles SELECT 'fixture-'||i,?1,json_set(?2,'$.id','fixture-'||i,'$.url','https://example.org/'||i) FROM n", params![source["id"].as_str(), article.to_string()]).unwrap();
    conn.execute("INSERT INTO states SELECT d.id,a.id,'{\"read\":true,\"saved\":false,\"hidden\":false}' FROM documents d CROSS JOIN articles a WHERE d.kind='profile' AND a.id LIKE 'fixture-%'", []).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<10000) INSERT INTO alert_log SELECT 'default','receipt-'||i,?1 FROM n", [now]).unwrap();
    let mut file = tempfile::tempfile().unwrap();
    db.export_writer(&mut file).unwrap();
    assert!(file.metadata().unwrap().len() > 32 * 1024 * 1024);
    assert!(db.export().unwrap_err().contains("32 MiB"));
    file.seek(SeekFrom::Start(0)).unwrap();
    let mut restored = Database::memory().unwrap();
    restored.import_reader(&mut file).unwrap();
    assert_eq!(
        restored.article("default", "fixture-0").unwrap()["history"],
        article["history"]
    );
    let mut roundtrip = tempfile::tempfile().unwrap();
    restored.export_writer(&mut roundtrip).unwrap();
    assert_eq!(
        file.metadata().unwrap().len(),
        roundtrip.metadata().unwrap().len()
    );
    file.seek(SeekFrom::Start(0)).unwrap();
    roundtrip.seek(SeekFrom::Start(0)).unwrap();
    let mut left = [0; 8192];
    let mut right = [0; 8192];
    loop {
        let n = file.read(&mut left).unwrap();
        let m = roundtrip.read(&mut right).unwrap();
        assert_eq!(&left[..n], &right[..m]);
        if n == 0 {
            break;
        }
    }
}

#[test]
fn native_json_import_handles_legacy_key_order_and_rejects_late_corruption_atomically() {
    let mut db = Database::memory().unwrap();
    let before = db.export().unwrap();
    let parsed: Value = serde_json::from_str(&before).unwrap();
    let reordered = format!(
        "{{\"states\":{},\"alerts\":{},\"articles\":{},\"documents\":{},\"version\":1}}",
        parsed["states"], parsed["alerts"], parsed["articles"], parsed["documents"]
    );
    db.import_reader(reordered.as_bytes()).unwrap();
    assert_eq!(db.export().unwrap(), before);
    let nested_duplicate = reordered.replace(
        "\"name\":\"Global\"",
        "\"name\":\"Global\",\"name\":\"Global\"",
    );
    assert_ne!(nested_duplicate, reordered);
    assert!(db.import_reader(nested_duplicate.as_bytes()).is_err());
    assert_eq!(db.export().unwrap(), before);
    for invalid in [format!("{reordered} null"), reordered.replace("\"version\":1", "\"version\":1,\"version\":1"), reordered.replace("\"version\":1", "\"version\":999"), reordered.replace("\"version\":1", "\"secret\":true,\"version\":1"), reordered.replace("\"states\":[]", "\"states\":[{\"profileId\":\"default\",\"articleId\":\"missing\",\"data\":{\"read\":true,\"saved\":false,\"hidden\":false}}]")] {
        assert!(db.import_reader(invalid.as_bytes()).is_err(), "accepted malformed backup");
        assert_eq!(db.export().unwrap(), before);
    }
}

#[test]
fn native_import_stops_an_oversized_record_before_reading_the_entire_input() {
    use std::{cell::Cell, rc::Rc};
    struct Oversized {
        consumed: Rc<Cell<usize>>,
    }
    impl Read for Oversized {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            buffer.fill(b'x');
            self.consumed.set(self.consumed.get() + buffer.len());
            Ok(buffer.len())
        }
    }
    let mut db = Database::memory().unwrap();
    let before = db.export().unwrap();
    let consumed = Rc::new(Cell::new(0));
    let reader = std::io::Cursor::new(b"{\"documents\":[{\"kind\":\"source\",\"id\":\"oversized\",\"scope\":\"\",\"data\":{\"notes\":\"")
        .chain(Oversized { consumed: consumed.clone() });
    let error = db.import_reader(reader).unwrap_err();
    assert!(
        error.contains("record exceeds 32 MiB"),
        "unexpected error: {error}"
    );
    assert!(
        consumed.get() <= 32 * 1024 * 1024 + 8192,
        "read beyond one record plus the bounded I/O buffer"
    );
    assert_eq!(db.export().unwrap(), before);
}

#[test]
fn failed_restore_commit_rolls_back_the_connection_and_replacement_identity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("commit-failure.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Before restore","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let before = db.export().unwrap();
    let token = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)
        .unwrap()["replacementToken"]
        .clone();
    let mut incoming: Value = serde_json::from_str(&before).unwrap();
    incoming["articles"][0]["title"] = json!("After restore");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE backup_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE backup_child(id INTEGER REFERENCES backup_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER reject_backup_commit AFTER INSERT ON articles BEGIN INSERT INTO backup_child VALUES(1); END;").unwrap();
    assert!(db.import_reader(incoming.to_string().as_bytes()).is_err());
    assert_eq!(db.export().unwrap(), before);
    assert_eq!(
        db.request(&json!({"op":"workspace_get","profileId":"default"}), now)
            .unwrap()["replacementToken"],
        token
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM backup_child", [], |row| row
            .get::<_, usize>(0))
            .unwrap(),
        0
    );
}

#[test]
fn legacy_15000_saves_remain_restorable_with_a_fresh_cache_without_limit_escalation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy-saves.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Legacy fixture","url":"https://example.org/story","excerpt":"text"}]}), now - 31 * 86400).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let conn = Connection::open(&path).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<14998) INSERT INTO articles SELECT 'legacy-'||i,?1,json_set(?2,'$.id','legacy-'||i,'$.url','https://example.org/legacy-'||i) FROM n", params![source["id"].as_str(), article.to_string()]).unwrap();
    conn.execute("INSERT INTO states SELECT 'default',id,'{\"read\":false,\"saved\":true,\"hidden\":false}' FROM articles", []).unwrap();
    let legacy = db.export().unwrap();
    let mut restored = Database::memory().unwrap();
    restored.import(&legacy).unwrap();
    assert_eq!(
        restored.article("default", "legacy-14998").unwrap()["saved"],
        true
    );
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<4999) INSERT INTO articles SELECT 'recent-'||i,?1,json_set(?2,'$.id','recent-'||i,'$.url','https://example.org/recent-'||i,'$.firstSeen',?3) FROM n", params![source["id"].as_str(), article.to_string(), now]).unwrap();
    assert_eq!(db.retain(now).unwrap(), 0);
    let mut file = tempfile::tempfile().unwrap();
    db.export_writer(&mut file).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    restored.import_reader(&mut file).unwrap();
    assert_eq!(
        restored.article("default", "recent-4999").unwrap()["saved"],
        false
    );
    conn.execute("INSERT INTO states VALUES('default','recent-0','{\"read\":false,\"saved\":true,\"hidden\":false}')", []).unwrap();
    assert!(db
        .export_writer(std::io::sink())
        .unwrap_err()
        .contains("saved stories"));
}

#[test]
fn native_backup_preserves_an_interrupted_refresh_cache_above_20000_articles_and_states() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("interrupted-refresh.db");
    let mut db = Database::open(&path).unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Cached fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let article = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"][0].clone();
    let conn = Connection::open(&path).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO articles SELECT 'cache-'||i,?1,json_set(?2,'$.id','cache-'||i,'$.url','https://example.org/cache-'||i) FROM n", params![source["id"].as_str(), article.to_string()]).unwrap();
    conn.execute("INSERT INTO states SELECT 'default',id,'{\"read\":true,\"saved\":false,\"hidden\":false}' FROM articles", []).unwrap();
    let mut file = tempfile::tempfile().unwrap();
    db.export_writer(&mut file).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    let target_path = dir.path().join("restored.db");
    let mut restored = Database::open(&target_path).unwrap();
    restored.import_reader(&mut file).unwrap();
    assert_eq!(
        restored.article("default", "cache-20000").unwrap()["read"],
        true
    );
    let target = Connection::open(&target_path).unwrap();
    for table in ["articles", "states"] {
        let original: usize = conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        let copied: usize = target
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(copied, original);
        assert!(copied > 20_000);
    }
    // Bypass SQLite's guard only to exercise the backup's corruption check.
    conn.pragma_update(None, "foreign_keys", false).unwrap();
    conn.execute("INSERT INTO states VALUES('default','missing','{\"read\":true,\"saved\":false,\"hidden\":false}')", []).unwrap();
    assert!(db
        .export_writer(std::io::sink())
        .unwrap_err()
        .contains("Invalid state reference"));
    conn.execute("DELETE FROM states WHERE article_id='missing'", [])
        .unwrap();
    conn.execute(
        "UPDATE articles SET data=json_set(data,'$.id','wrong') WHERE id='cache-0'",
        [],
    )
    .unwrap();
    assert!(db
        .export_writer(std::io::sink())
        .unwrap_err()
        .contains("article identity"));
}
