use news_terminal_lib::{db::Database, intelligence};
use rusqlite::{params, Connection, StatementStatus};
use serde_json::{json, Value};
use std::path::Path;

const NOW: i64 = 1_800_000_000;

fn source(db: &mut Database) -> Value {
    db.request(&json!({"op":"source_add","name":"Follow-up fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":["science"],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), NOW).unwrap()
}

fn feed(title: &str, urls: &[&str]) -> Value {
    json!({"articles":urls.iter().map(|url| json!({"title":title,"url":url,"excerpt":"Publisher supplied excerpt.","publishedAt":NOW})).collect::<Vec<_>>()})
}

fn search_ids(db: &mut Database, query: &str) -> Vec<String> {
    let result = db
        .request(&json!({"op":"search","query":query}), NOW)
        .unwrap();
    let mut ids = result
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn v1_database(path: &Path) -> (Connection, Value) {
    let mut fixture = Database::memory().unwrap();
    let source = source(&mut fixture);
    let sid = source["id"].as_str().unwrap();
    fixture
        .ingest(
            sid,
            &feed("Original searchable headline", &["https://example.org/a"]),
            NOW,
        )
        .unwrap();
    fixture
        .ingest(
            sid,
            &feed("Replacement searchable report", &["https://example.org/a"]),
            NOW + 1,
        )
        .unwrap();
    let snapshot = fixture.request(&json!({"op":"snapshot"}), NOW + 1).unwrap();
    fixture.request(&json!({"op":"article_state","articleId":snapshot["articles"][0]["id"],"saved":true,"read":true,"replacementToken":snapshot["replacementToken"]}), NOW+1).unwrap();
    let content: Value = serde_json::from_str(&fixture.export().unwrap()).unwrap();
    let conn = Connection::open(path).unwrap();
    // Keep this connection open so the upgrade must capture committed WAL rows.
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    conn.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    for document in content["documents"].as_array().unwrap() {
        conn.execute(
            "INSERT INTO documents(kind,id,scope,data) VALUES(?1,?2,?3,?4)",
            params![
                document["kind"].as_str(),
                document["id"].as_str(),
                document["scope"].as_str(),
                document["data"].to_string()
            ],
        )
        .unwrap();
    }
    for article in content["articles"].as_array().unwrap() {
        conn.execute(
            "INSERT INTO articles(id,source_id,data) VALUES(?1,?2,?3)",
            params![
                article["id"].as_str(),
                article["sourceId"].as_str(),
                article.to_string()
            ],
        )
        .unwrap();
    }
    for state in content["states"].as_array().unwrap() {
        conn.execute(
            "INSERT INTO states(profile_id,article_id,data) VALUES(?1,?2,?3)",
            params![
                state["profileId"].as_str(),
                state["articleId"].as_str(),
                state["data"].to_string()
            ],
        )
        .unwrap();
    }
    (conn, content)
}

fn assert_v1_snapshot(conn: &Connection, content: &Value) {
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    for document in content["documents"].as_array().unwrap() {
        let data: String = conn
            .query_row(
                "SELECT data FROM documents WHERE kind=?1 AND id=?2 AND scope=?3",
                params![
                    document["kind"].as_str(),
                    document["id"].as_str(),
                    document["scope"].as_str()
                ],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&data).unwrap(),
            document["data"]
        );
    }
    for article in content["articles"].as_array().unwrap() {
        let data: String = conn
            .query_row(
                "SELECT data FROM articles WHERE id=?1",
                [article["id"].as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&data).unwrap(), *article);
        let found: String = conn
            .query_row(
                "SELECT id FROM articles_fts WHERE articles_fts MATCH 'Replacement'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, article["id"].as_str().unwrap());
    }
    for state in content["states"].as_array().unwrap() {
        let data: String = conn
            .query_row(
                "SELECT data FROM states WHERE profile_id=?1 AND article_id=?2",
                params![state["profileId"].as_str(), state["articleId"].as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&data).unwrap(), state["data"]);
    }
}

#[test]
fn v1_upgrade_saves_a_coherent_version_specific_snapshot_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite3");
    let (_wal_owner, content) = v1_database(&path);
    let old_snapshot = path.with_extension("pre-migration.sqlite3");
    std::fs::write(&old_snapshot, b"older v0 snapshot").unwrap();
    let snapshot_path = path.with_extension("v1.pre-migration.sqlite3");
    let upgraded = Database::open(&path).unwrap();
    assert!(
        snapshot_path.is_file(),
        "a v0 snapshot must not substitute for the current v1 database"
    );
    assert_eq!(std::fs::read(&old_snapshot).unwrap(), b"older v0 snapshot");
    let snapshot = Connection::open(&snapshot_path).unwrap();
    assert_v1_snapshot(&snapshot, &content);
    drop(snapshot);
    drop(upgraded);
    let bytes = std::fs::read(&snapshot_path).unwrap();
    let preserved = dir.path().join("saved-v1-snapshot.sqlite3");
    std::fs::rename(&snapshot_path, &preserved).unwrap();
    Database::open(&path).unwrap();
    assert!(
        !snapshot_path.exists(),
        "current-schema opens must not repeat the backup"
    );
    assert_eq!(std::fs::read(&preserved).unwrap(), bytes);
    assert!(!path.with_extension("v2.pre-migration.sqlite3").exists());
}

#[test]
fn an_existing_version_specific_snapshot_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing-snapshot.sqlite3");
    let (_wal_owner, _) = v1_database(&path);
    let snapshot_path = path.with_extension("v1.pre-migration.sqlite3");
    let snapshot = Connection::open(&snapshot_path).unwrap();
    snapshot.execute_batch("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('keep this snapshot'); PRAGMA user_version=1;").unwrap();
    drop(snapshot);
    let bytes = std::fs::read(&snapshot_path).unwrap();
    Database::open(&path).unwrap();
    assert_eq!(std::fs::read(&snapshot_path).unwrap(), bytes);
}

#[test]
fn an_unavailable_snapshot_destination_prevents_upgrade_without_data_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("blocked-snapshot.sqlite3");
    let (original, content) = v1_database(&path);
    let snapshot_path = path.with_extension("v1.pre-migration.sqlite3");
    std::fs::create_dir(&snapshot_path).unwrap();
    assert!(
        Database::open(&path).is_err(),
        "migration must stop when its snapshot cannot be saved"
    );
    assert_v1_snapshot(&original, &content);
    assert_eq!(std::fs::read_dir(&snapshot_path).unwrap().count(), 0);
    assert!(std::fs::read_dir(dir.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".news-terminal-migration-")));
    std::fs::remove_dir(&snapshot_path).unwrap();
    Database::open(&path).unwrap();
    assert_v1_snapshot(&Connection::open(&snapshot_path).unwrap(), &content);
}

fn search_maintenance_work(count: usize, update: bool) -> i32 {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("delete-work.db");
    let mut db = Database::open(&path).unwrap();
    let source = source(&mut db);
    db.ingest(
        source["id"].as_str().unwrap(),
        &feed(
            "Original searchable headline",
            &["https://example.org/original"],
        ),
        NOW,
    )
    .unwrap();
    let article = db.request(&json!({"op":"snapshot"}), NOW).unwrap()["articles"][0].clone();
    let conn = Connection::open(&path).unwrap();
    conn.execute("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?1) INSERT INTO articles SELECT 'work-'||i,?2,json_set(?3,'$.id','work-'||i,'$.url','https://example.org/work-'||i) FROM n", params![count, source["id"].as_str(), article.to_string()]).unwrap();
    let sql = if update {
        "UPDATE articles SET data=json_set(data,'$.title','Replacement searchable headline')"
    } else {
        "DELETE FROM articles"
    };
    let mut statement = conn.prepare(sql).unwrap();
    statement.execute([]).unwrap();
    let work = statement.get_status(StatementStatus::VmStep);
    assert_eq!(
        conn.query_row("SELECT count(*) FROM articles_fts", [], |row| row
            .get::<_, usize>(0))
            .unwrap(),
        if update { count + 1 } else { 0 }
    );
    println!(
        "update={update}, rows={}, SQLite VM steps={work}",
        count + 1
    );
    work
}

#[test]
fn search_cleanup_work_grows_with_changed_rows_instead_of_the_corpus_squared() {
    let small = search_maintenance_work(500, false);
    let large = search_maintenance_work(1000, false);
    assert!(large < small * 3, "doubling the library must not quadruple search cleanup work: {small} -> {large} SQLite VM steps");
}

#[test]
fn search_update_work_grows_with_changed_rows_instead_of_the_corpus_squared() {
    let small = search_maintenance_work(500, true);
    let large = search_maintenance_work(1000, true);
    assert!(large < small * 3, "doubling the library must not quadruple search update work: {small} -> {large} SQLite VM steps");
}

#[test]
fn legacy_search_rowids_are_repaired_before_update_retention_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy-search.db");
    let mut db = Database::open(&path).unwrap();
    let source = source(&mut db);
    let sid = source["id"].as_str().unwrap();
    db.ingest(
        sid,
        &feed(
            "Original searchable headline",
            &["https://example.org/a", "https://example.org/b"],
        ),
        NOW,
    )
    .unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), NOW).unwrap();
    let a = snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["url"] == "https://example.org/a")
        .unwrap()
        .clone();
    let b = snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["url"] == "https://example.org/b")
        .unwrap()
        .clone();
    db.request(&json!({"op":"article_state","articleId":a["id"],"saved":true,"read":true,"replacementToken":snapshot["replacementToken"]}), NOW).unwrap();
    drop(db);
    let conn = Connection::open(&path).unwrap();
    // Legacy FTS rowids were independently allocated and can differ from article rowids.
    conn.execute_batch("DROP TRIGGER article_insert; DROP TRIGGER article_delete; DROP TRIGGER article_update;
        DELETE FROM articles_fts;
        INSERT INTO articles_fts(rowid,id,title,excerpt) SELECT rowid+100,id,json_extract(data,'$.title'),json_extract(data,'$.excerpt') FROM articles;
        CREATE TRIGGER article_insert AFTER INSERT ON articles BEGIN INSERT INTO articles_fts(id,title,excerpt) VALUES(new.id,json_extract(new.data,'$.title'),json_extract(new.data,'$.excerpt')); END;
        CREATE TRIGGER article_delete AFTER DELETE ON articles BEGIN DELETE FROM articles_fts WHERE id=old.id; END;
        CREATE TRIGGER article_update AFTER UPDATE ON articles BEGIN DELETE FROM articles_fts WHERE id=old.id; INSERT INTO articles_fts(id,title,excerpt) VALUES(new.id,json_extract(new.data,'$.title'),json_extract(new.data,'$.excerpt')); END;
        PRAGMA user_version=1;").unwrap();
    drop(conn);

    let mut db = Database::open(&path).unwrap();
    // The search identity remains stable even if SQLite reorganizes table rowids.
    Connection::open(&path)
        .unwrap()
        .execute_batch("VACUUM")
        .unwrap();
    assert_eq!(search_ids(&mut db, "Original"), {
        let mut ids = vec![
            a["id"].as_str().unwrap().to_owned(),
            b["id"].as_str().unwrap().to_owned(),
        ];
        ids.sort();
        ids
    });
    db.ingest(
        sid,
        &feed("Replacement searchable report", &["https://example.org/a"]),
        NOW + 1,
    )
    .unwrap();
    assert_eq!(
        search_ids(&mut db, "Original"),
        vec![b["id"].as_str().unwrap()]
    );
    assert_eq!(
        search_ids(&mut db, "Replacement"),
        vec![a["id"].as_str().unwrap()]
    );
    assert_eq!(db.retain(NOW + 31 * 86400).unwrap(), 1);
    assert!(search_ids(&mut db, "Original").is_empty());
    let saved = db.article("default", a["id"].as_str().unwrap()).unwrap();
    assert_eq!(saved["saved"], true);
    assert_eq!(saved["read"], true);
    assert_eq!(saved["history"][0]["title"], "Original searchable headline");
    let backup = db.export().unwrap();
    db.import(&backup).unwrap();
    assert_eq!(
        search_ids(&mut db, "Replacement"),
        vec![a["id"].as_str().unwrap()]
    );
    assert_eq!(
        db.article("default", a["id"].as_str().unwrap()).unwrap(),
        saved
    );
    drop(db);
    let mut reopened = Database::open(&path).unwrap();
    assert_eq!(
        search_ids(&mut reopened, "Replacement"),
        vec![a["id"].as_str().unwrap()]
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM articles_fts", [], |row| row
            .get::<_, usize>(0))
            .unwrap(),
        1
    );
}

#[test]
fn unrelated_correction_releases_the_automatic_group_anchor_and_preserves_manual_splits() {
    let mut db = Database::memory().unwrap();
    let source = source(&mut db);
    let sid = source["id"].as_str().unwrap();
    let original = "Agency confirms new telescope launch schedule for September";
    db.ingest(
        sid,
        &feed(
            original,
            &["https://example.org/a", "https://example.org/b"],
        ),
        NOW,
    )
    .unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), NOW).unwrap();
    let a = snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["url"] == "https://example.org/a")
        .unwrap()
        .clone();
    let b = snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["url"] == "https://example.org/b")
        .unwrap()
        .clone();
    assert_eq!(a["groupId"], a["id"], "correct the original group anchor");
    assert_eq!(a["groupId"], b["groupId"]);
    db.request(&json!({"op":"group_split","articleId":a["id"],"replacementToken":snapshot["replacementToken"]}), NOW).unwrap();
    db.request(&json!({"op":"article_state","articleId":a["id"],"read":true,"saved":true,"replacementToken":snapshot["replacementToken"]}), NOW).unwrap();
    let split = db.article("default", a["id"].as_str().unwrap()).unwrap();
    let correction = feed(
        "Museum opens pottery exhibition honoring regional ceramic artists",
        &["https://example.org/a"],
    );
    assert_eq!(db.ingest(sid, &correction, NOW + 1).unwrap(), 1);
    let changed = db.article_raw(a["id"].as_str().unwrap()).unwrap().unwrap();
    let peer = db.article_raw(b["id"].as_str().unwrap()).unwrap().unwrap();
    assert!(!intelligence::related(&changed, &peer));
    assert_ne!(
        changed["groupId"], peer["groupId"],
        "old peers must not remain in the corrected story's automatic group"
    );
    assert_eq!(changed["firstSeen"], a["firstSeen"]);
    assert_eq!(changed["history"][0]["title"], original);
    let manual = db.article("default", a["id"].as_str().unwrap()).unwrap();
    assert_eq!(manual["groupId"], split["groupId"]);
    assert_eq!(manual["read"], true);
    assert_eq!(manual["saved"], true);
    assert_eq!(db.ingest(sid, &correction, NOW + 2).unwrap(), 0);
    assert_eq!(
        db.article_raw(a["id"].as_str().unwrap()).unwrap().unwrap(),
        changed
    );
}

#[test]
fn grouping_uses_current_versions_of_other_stories_in_the_same_refresh() {
    let mut db = Database::memory().unwrap();
    let source = source(&mut db);
    let sid = source["id"].as_str().unwrap();
    db.ingest(
        sid,
        &feed(
            "Agency confirms new telescope launch schedule for September",
            &["https://example.org/a", "https://example.org/b"],
        ),
        NOW,
    )
    .unwrap();
    let mut correction = feed(
        "Museum opens pottery exhibition honoring regional ceramic artists",
        &["https://example.org/a"],
    );
    correction["articles"].as_array_mut().unwrap().extend(
        feed(
            "Agency confirms telescope launch schedule for September",
            &["https://example.org/b"],
        )["articles"]
            .as_array()
            .unwrap()
            .iter()
            .cloned(),
    );
    db.ingest(sid, &correction, NOW + 1).unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), NOW + 1).unwrap();
    let articles = snapshot["articles"].as_array().unwrap();
    assert!(!intelligence::related(&articles[0], &articles[1]));
    assert_ne!(
        articles[0]["groupId"], articles[1]["groupId"],
        "a stale pre-refresh version must not recreate the old relationship"
    );
    db.ingest(
        sid,
        &feed(
            "Museum opens pottery exhibition honoring regional ceramic artists",
            &["https://example.org/a", "https://example.org/b"],
        ),
        NOW + 2,
    )
    .unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), NOW + 2).unwrap();
    let articles = snapshot["articles"].as_array().unwrap();
    assert!(intelligence::related(&articles[0], &articles[1]));
    assert_eq!(
        articles[0]["groupId"], articles[1]["groupId"],
        "matching current versions must still group"
    );
}

#[test]
fn search_migration_failure_preserves_the_legacy_index_and_can_retry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("failed-search-migration.db");
    let mut db = Database::open(&path).unwrap();
    let source = source(&mut db);
    db.ingest(
        source["id"].as_str().unwrap(),
        &feed("Original searchable headline", &["https://example.org/a"]),
        NOW,
    )
    .unwrap();
    drop(db);
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE IF NOT EXISTS article_search_ids(fts_id INTEGER PRIMARY KEY,article_id TEXT NOT NULL UNIQUE);
        CREATE TRIGGER fail_search_migration BEFORE INSERT ON article_search_ids BEGIN SELECT RAISE(ABORT,'migration failure fixture'); END;
        PRAGMA user_version=1;").unwrap();
    let before: String = conn
        .query_row(
            "SELECT json_group_array(json_array(rowid,id,title,excerpt)) FROM articles_fts",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        Database::open(&path).is_err(),
        "the migration must encounter the injected SQLite failure"
    );
    let snapshot = Connection::open(path.with_extension("v1.pre-migration.sqlite3")).unwrap();
    assert_eq!(
        snapshot
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        snapshot
            .query_row(
                "SELECT json_group_array(json_array(rowid,id,title,excerpt)) FROM articles_fts",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        before
    );
    drop(snapshot);
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row(
            "SELECT json_group_array(json_array(rowid,id,title,excerpt)) FROM articles_fts",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        before
    );
    conn.execute_batch("DROP TRIGGER fail_search_migration")
        .unwrap();
    let mut db = Database::open(&path).unwrap();
    assert_eq!(search_ids(&mut db, "Original").len(), 1);
}

#[test]
fn reopening_a_current_search_schema_does_not_rebuild_its_index() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("current-search.db");
    let mut db = Database::open(&path).unwrap();
    let source = source(&mut db);
    db.ingest(
        source["id"].as_str().unwrap(),
        &feed("Original searchable headline", &["https://example.org/a"]),
        NOW,
    )
    .unwrap();
    drop(db);
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_search_rebuild_insert BEFORE INSERT ON article_search_ids BEGIN SELECT RAISE(ABORT,'current search must not rebuild'); END;
        CREATE TRIGGER reject_search_rebuild_delete BEFORE DELETE ON article_search_ids BEGIN SELECT RAISE(ABORT,'current search must not rebuild'); END;").unwrap();
    for _ in 0..2 {
        let mut reopened = Database::open(&path).unwrap();
        assert_eq!(search_ids(&mut reopened, "Original").len(), 1);
    }
}
