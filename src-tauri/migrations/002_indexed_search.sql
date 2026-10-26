-- Keep a stable integer FTS identity even if SQLite VACUUM changes article rowids.
-- This migration runs in the initialization transaction, once for each v1 database.
DROP TRIGGER IF EXISTS article_insert;
DROP TRIGGER IF EXISTS article_delete;
DROP TRIGGER IF EXISTS article_update;
CREATE TABLE IF NOT EXISTS article_search_ids(fts_id INTEGER PRIMARY KEY,article_id TEXT NOT NULL UNIQUE);
DELETE FROM article_search_ids;
DELETE FROM articles_fts;
INSERT INTO article_search_ids(fts_id,article_id) SELECT rowid,id FROM articles;
INSERT INTO articles_fts(rowid,id,title,excerpt)
    SELECT s.fts_id,a.id,json_extract(a.data,'$.title'),json_extract(a.data,'$.excerpt')
    FROM articles a JOIN article_search_ids s ON s.article_id=a.id;
CREATE TRIGGER article_insert AFTER INSERT ON articles BEGIN
    INSERT INTO article_search_ids(article_id) VALUES(new.id);
    INSERT INTO articles_fts(rowid,id,title,excerpt)
        VALUES((SELECT fts_id FROM article_search_ids WHERE article_id=new.id),new.id,json_extract(new.data,'$.title'),json_extract(new.data,'$.excerpt'));
END;
CREATE TRIGGER article_delete AFTER DELETE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid=(SELECT fts_id FROM article_search_ids WHERE article_id=old.id);
    DELETE FROM article_search_ids WHERE article_id=old.id;
END;
CREATE TRIGGER article_update AFTER UPDATE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid=(SELECT fts_id FROM article_search_ids WHERE article_id=old.id);
    UPDATE article_search_ids SET article_id=new.id WHERE article_id=old.id;
    INSERT INTO articles_fts(rowid,id,title,excerpt)
        VALUES((SELECT fts_id FROM article_search_ids WHERE article_id=new.id),new.id,json_extract(new.data,'$.title'),json_extract(new.data,'$.excerpt'));
END;
PRAGMA user_version=2;
