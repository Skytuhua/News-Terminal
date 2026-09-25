#!/usr/bin/env python3
"""Offline synthetic native benchmark; never opens the application data directory.

Copies the production Rust modules to a temporary standalone crate, appends private
measurement accessors, and builds ONLY that crate with its own target directory.
No app code, shared Cargo files, release artifacts, feeds, AI or credentials used.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tempfile
import time
import tomllib

ROOT = Path(__file__).resolve().parents[1]
MODULES = ["db.rs", "db/backup.rs", "intelligence.rs", "rights.rs", "media.rs",
           "services.rs", "briefing.rs", "sector_summary.rs"]
INPUTS = ([f"src-tauri/src/{p}" for p in MODULES] +
          ["src-tauri/migrations/001_initial.sql", "resources/sources.json",
           "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src/App.tsx"])

# Appended only to the temporary COPY. Existing function bodies remain byte-identical.
ACCESSORS = r'''
impl Database {
    pub fn perf_articles(&self) -> Vec<Value> { self.articles("default", None).unwrap() }
    pub fn perf_workspace(&self) -> Result<Value> {
        self.require_profile("default")?;
        Ok(self.get("workspace", "default", "")?.unwrap_or_else(workspace))
    }
    pub fn perf_read_only(&self) {
        self.conn.execute_batch("PRAGMA query_only=ON").unwrap();
    }
    pub fn perf_seed(&mut self, n: usize, saved_old: usize, sources: usize, now: i64) {
        self.conn.execute_batch("BEGIN IMMEDIATE; DELETE FROM documents WHERE kind='source';").unwrap();
        for source in 0..sources {
            let id = format!("synthetic-{source}");
            self.put("source", &id, "", &json!({"id":id,"name":format!("Synthetic {source}"),
                "url":"https://example.invalid/feed","homepage":"https://example.invalid",
                "termsUrl":"https://example.invalid/terms","kind":"reporting","topics":["science"],
                "region":"world","language":"en","enabled":true,"status":"Synthetic fixture",
                "storage":"excerpt","aiAllowed":false,"mediaAllowed":false})).unwrap();
        }
        let mut insert = self.conn.prepare("INSERT INTO articles(id,source_id,data) VALUES(?1,?2,?3)").unwrap();
        let mut state = self.conn.prepare("INSERT INTO states(profile_id,article_id,data) VALUES(?1,?2,?3)").unwrap();
        for i in 0..n {
            let id = format!("synthetic-{i:06}");
            let source = format!("synthetic-{}", i % sources);
            let data = json!({"id":id,"sourceId":source,"sourceName":format!("Synthetic {}",i%sources),
                "title":format!("Synthetic {} {i}: science daily report",if i%10==0 {"needle"} else {"report"}),
                "url":format!("https://example.invalid/story/{i}"),
                "excerpt":"Synthetic permitted feed excerpt for reproducible native measurements. ".repeat(4),
                "publishedAt":now-i as i64*60,"firstSeen":now-i as i64*60,"updatedAt":now,
                "topics":["science"],"region":"world","language":"en","kind":"reporting",
                "read":false,"saved":false,"hidden":false,"groupId":format!("g{}",i/3),
                "history":[],"media":[],"aiAllowed":false});
            insert.execute(params![id,source,data.to_string()]).unwrap();
            let saved = i >= 5000 && i < 5000 + saved_old;
            state.execute(params!["default",id,json!({"read":i%3==0,"saved":saved,"hidden":false}).to_string()]).unwrap();
            // Other-profile saves must never enlarge the default snapshot.
            state.execute(params!["other",id,r#"{"read":false,"saved":true,"hidden":false}"#]).unwrap();
        }
        drop(insert); drop(state);
        self.conn.execute_batch("COMMIT; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    }
    pub fn perf_plan(&self, query: &str, arg: &str) -> Vec<String> {
        let mut s = self.conn.prepare(&format!("EXPLAIN QUERY PLAN {query}")).unwrap();
        s.query_map(params!["default",arg], |r| r.get::<_,String>(3)).unwrap()
            .map(|r|r.unwrap()).collect()
    }
    pub fn perf_integrity(&self) {
        let result: String = self.conn.query_row("PRAGMA integrity_check",[],|r|r.get(0)).unwrap();
        assert_eq!(result,"ok");
        assert_eq!(self.conn.query_row("SELECT count(*) FROM pragma_foreign_key_check",[],|r|r.get::<_,usize>(0)).unwrap(),0);
    }
}
'''

RUST = r'''
#![allow(dead_code)]
mod db; mod intelligence; mod rights; mod media; mod services; mod briefing; mod sector_summary;
use serde_json::{json, Value};
use std::{collections::HashSet, hint::black_box, time::Instant};
const NOW: i64 = 1790184000;
fn timed<T>(f: impl FnOnce() -> T) -> (T, f64) {
    let start = Instant::now(); let value = black_box(f());
    (value, start.elapsed().as_secs_f64()*1000.0)
}
fn ids(v: &[Value]) -> HashSet<String> {
    v.iter().map(|a|a["id"].as_str().unwrap().to_string()).collect()
}
fn check_articles(v: &[Value], n: usize, saved: usize) {
    assert_eq!(v.len(), n.min(5000)+saved);
    assert_eq!(ids(v).len(),v.len());
    for a in v {
        let i = a["id"].as_str().unwrap().strip_prefix("synthetic-").unwrap().parse::<usize>().unwrap();
        assert!(i < n.min(5000) || (i >= 5000 && i < 5000+saved));
        assert_eq!(a["saved"],json!(i>=5000 && i<5000+saved));
        assert_eq!(a["read"],json!(i%3==0));
    }
}
fn check_search(v: &Value, n: usize, step: usize) {
    let v=v.as_array().unwrap();
    assert_eq!(v.len(), n.div_ceil(step).min(5000));
    for (j,a) in v.iter().enumerate() {
        assert_eq!(a["id"],json!(format!("synthetic-{:06}",j*step)));
    }
}
fn main() {
    let args:Vec<_>=std::env::args().collect();
    let dir=std::path::Path::new(&args[1]);
    let trials:usize=args[2].parse().unwrap();
    let warmups:usize=args[3].parse().unwrap();
    let smoke=args[4]=="smoke";
    // Balanced ceiling; retained-unsaved control; overflow; concentrated-source stress.
    let scenarios = [("small",500,0,19),("ceiling",5000,0,19),
        ("retained-unsaved",20000,0,19),("saved-5000",10000,5000,19),
        ("saved-15000",20000,15000,19),("single-source",5000,0,1),
        ("single-source-saved",10000,5000,1)];
    for (name,n,saved,sources) in scenarios {
        if smoke && name!="small" {continue;}
        let path=dir.join(format!("{name}.sqlite3"));
        assert!(!path.exists(),"Only new synthetic DB paths are allowed");
        let mut database=db::Database::open(&path).unwrap();
        database.perf_seed(n,saved,sources,NOW);
        database.perf_integrity(); database.perf_read_only();
        let snapshot_request=json!({"op":"snapshot","profileId":"default"});
        let needle_request=json!({"op":"search","profileId":"default","query":"needle"});
        let broad_request=json!({"op":"search","profileId":"default","query":"Synthetic"});
        let (first,first_ms)=timed(||database.request(&snapshot_request,NOW).unwrap());
        check_articles(first["articles"].as_array().unwrap(),n,saved);
        let pref=first["profile"]["preferences"].clone();
        let expected_workspace=first["workspace"].clone();
        let base=database.perf_articles();
        let ranked=intelligence::rank(base.clone(),&pref,NOW);
        assert_eq!(ranked,first["articles"].as_array().unwrap().clone());
        assert_eq!(ids(&ranked),ids(&base));
        let encoded=serde_json::to_vec(&first).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&encoded).unwrap(),first);
        let bytes=encoded.len();
        let first_order:Vec<_>=ranked.iter().map(|a|a["id"].clone()).collect();
        let relaxed=ranked.iter().filter(|a|a["reasons"].as_array().unwrap().iter()
            .any(|r|r.as_str().unwrap().starts_with("Source diversity cap relaxed"))).count();
        let snapshot_sql=include_str!("snapshot.sql");
        let search_sql=include_str!("search.sql");
        let plans=json!({"snapshot":database.perf_plan(snapshot_sql,""),
            "needle":database.perf_plan(search_sql,"\"needle\"")});
        drop(ranked); drop(encoded);
        for trial in 0..warmups+trials {
            let mut measures=serde_json::Map::new();
            // Rotate order to reduce monotonic thermal/cache bias across operations.
            for offset in 0..8 {
                match (offset+trial)%8 {
                    0 => {
                        let (v,ms)=timed(||database.perf_articles());
                        check_articles(&v,n,saved); measures.insert("articles_sql_decode_state_ms".into(),json!(ms));
                    }
                    1 => {
                        // Input clone deliberately excluded: rank consumes the article vector.
                        let input=base.clone();
                        let (v,ms)=timed(||intelligence::rank(input,&pref,NOW));
                        assert_eq!(v.iter().map(|a|a["id"].clone()).collect::<Vec<_>>(),first_order);
                        check_articles(&v,n,saved); measures.insert("rank_ms".into(),json!(ms));
                    }
                    2 => {
                        let (v,ms)=timed(||database.request(&snapshot_request,NOW).unwrap());
                        assert_eq!(v,first); measures.insert("snapshot_ms".into(),json!(ms));
                    }
                    3 => {
                        let (v,ms)=timed(||serde_json::to_vec(&first).unwrap());
                        assert_eq!(v.len(),bytes); measures.insert("json_encode_ms".into(),json!(ms));
                    }
                    4 => {
                        let (v,ms)=timed(||database.request(&needle_request,NOW).unwrap());
                        check_search(&v,n,10); measures.insert("search_10pct_ms".into(),json!(ms));
                    }
                    5 => {
                        let (v,ms)=timed(||database.request(&broad_request,NOW).unwrap());
                        check_search(&v,n,1); measures.insert("search_all_ms".into(),json!(ms));
                    }
                    6 => {
                        // Batch tiny reads to avoid resolution/clock overhead dominating.
                        let (v,ms)=timed(||{let mut v=Value::Null; for _ in 0..100 {
                            v=black_box(database.perf_workspace().unwrap()); } v});
                        assert_eq!(v,expected_workspace);
                        measures.insert("workspace_direct_per_read_ms".into(),json!(ms/100.0));
                    }
                    _ => {
                        // Three sequential full reads, using just workspace as the UI pre-read does.
                        // Drop article payloads inside this timer, representative of discarded reads.
                        let (v,ms)=timed(||{let mut v=Value::Null; for _ in 0..3 {
                            let snap=database.request(&snapshot_request,NOW).unwrap();
                            v=black_box(snap["workspace"].clone()); } v});
                        assert_eq!(v,expected_workspace);
                        measures.insert("three_workspace_snapshots_ms".into(),json!(ms));
                    }
                }
            }
            if trial>=warmups {
                println!("{}",json!({"kind":"sample","scenario":name,"trial":trial-warmups+1,"metrics":measures}));
            }
        }
        database.perf_integrity();
        let snapshot=database.request(&snapshot_request,NOW).unwrap(); assert_eq!(snapshot,first);
        println!("{}",json!({"kind":"scenario","name":name,"retained":n,"savedOverflow":saved,
            "sources":sources,"snapshotRows":n.min(5000)+saved,"snapshotBytes":bytes,
            "firstPostSeedSnapshotMs":first_ms,"diversityRelaxedRows":relaxed,"queryPlans":plans,
            "sqliteVersion":rusqlite::version(),"readOnlyDuringMeasurement":true,
            "checks":"integrity, foreign keys, exact IDs, state merge, profile isolation, saved reachability, ranking order, search counts/order/cap, serialization roundtrip, unchanged snapshot/workspace"}));
    }
}
'''


def hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in INPUTS}


def summarize(records, trials, expected_scenarios):
    scenarios = [r for r in records if r["kind"] == "scenario"]
    assert len(scenarios) == expected_scenarios
    result = []
    for scenario in scenarios:
        samples = [r for r in records if r["kind"] == "sample" and r["scenario"] == scenario["name"]]
        assert [s["trial"] for s in samples] == list(range(1, trials + 1))
        metrics = {}
        for key in samples[0]["metrics"]:
            values = [s["metrics"][key] for s in samples]
            assert all(math.isfinite(v) and v >= 0 for v in values)
            metrics[key] = {"median": statistics.median(values), "min": min(values), "max": max(values), "n": len(values)}
        result.append({**scenario, "metrics": metrics})
    assert len(records) == expected_scenarios * (trials + 1)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=9)
    parser.add_argument("--warmups", type=int, default=2)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--output", default="docs/evidence/v04-performance-native.json")
    args = parser.parse_args()
    if args.trials < 3 or args.warmups < 1:
        parser.error("Use at least three measured trials and one warmup")
    output = (ROOT / args.output).resolve()
    if output.parent != (ROOT / "docs/evidence").resolve() or not output.name.startswith("v04-performance-") or output.suffix != ".json":
        parser.error("Output must be docs/evidence/v04-performance-*.json")
    if output.exists():
        parser.error("Refusing to overwrite evidence; choose a new output filename")
    initial = hashes()
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {"schemaVersion": 1, "kind": "synthetic standalone native production-function benchmark, not Tauri IPC/UI latency",
              "startedAt": started, "trials": args.trials, "warmups": args.warmups,
              "sourceHashesAtStart": initial, "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "environment": {"platform": platform.platform(), "logicalCpus": os.cpu_count(),
                              "processor": os.environ.get("PROCESSOR_IDENTIFIER", platform.processor()),
                              "python": platform.python_version(), "rustc": subprocess.check_output(["rustc", "--version"], text=True).strip(),
                              "cargo": subprocess.check_output(["cargo", "--version"], text=True).strip(),
                              "gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()},
              "method": {"now": 1790184000, "profile": "default", "diversityCap": 0.5,
                         "build": "standalone release opt-level=3; offline copied lockfile; separate target; no Tauri build",
                         "timers": "Rust Instant, warmups excluded, 8 operations rotated each trial",
                         "database": "fresh temporary file, production schema/FTS triggers, deterministic direct seed, WAL, query_only during measurement",
                         "workspace": "current require_profile/get functions exposed in temp copy; proposed narrow read, not existing endpoint",
                         "exclusions": "OS cold caches, IPC, lock contention, GUI, feed ingest, network, AI, production data"},
              "records": []}
    try:
        with tempfile.TemporaryDirectory(prefix="news-terminal-v04-native-") as tmp:
            temp = Path(tmp)
            crate = temp / "src-tauri"
            (crate / "src/db").mkdir(parents=True)
            (crate / "migrations").mkdir()
            (temp / "resources").mkdir()
            for p in MODULES:
                shutil.copyfile(ROOT / "src-tauri/src" / p, crate / "src" / p)
            for p in ["src-tauri/migrations/001_initial.sql", "resources/sources.json"]:
                shutil.copyfile(ROOT / p, temp / p)
            # Expose private functions without rewriting their bodies or copying their SQL by hand.
            source = (crate / "src/db.rs").read_text(encoding="utf-8")
            import re
            snapshot_sql = re.findall(r'"(SELECT a\.data,s\.data FROM articles a[^"\n]+)"', source)
            assert len(snapshot_sql) == 3, "Review changed SQL shape before benchmarking"
            search = next(s for s in snapshot_sql if "articles_fts MATCH" in s)
            snapshot = next(s for s in snapshot_sql if "WHERE ?2=''" in s)
            (crate / "src/snapshot.sql").write_text(snapshot, encoding="utf-8")
            (crate / "src/search.sql").write_text(search, encoding="utf-8")
            with (crate / "src/db.rs").open("a", encoding="utf-8") as f:
                f.write(ACCESSORS)
            (crate / "src/main.rs").write_text(RUST, encoding="utf-8")
            manifest = (ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8")
            deps = manifest.split("[dependencies]", 1)[1].split("[dev-dependencies]", 1)[0]
            deps = "\n".join(line for line in deps.splitlines() if not line.startswith("tauri"))
            (crate / "Cargo.toml").write_text('[package]\nname="news-terminal-v04-native-probe"\nversion="0.0.0"\nedition="2021"\n[dependencies]\n' + deps + '\n[profile.release]\nopt-level=3\n', encoding="utf-8")
            shutil.copyfile(ROOT / "src-tauri/Cargo.lock", crate / "Cargo.lock")
            env = {**os.environ, "CARGO_TARGET_DIR": str(temp / "target"), "CARGO_NET_OFFLINE": "true"}
            build_start = time.perf_counter()
            build = subprocess.run(["cargo", "build", "--release", "--offline", "--manifest-path", str(crate / "Cargo.toml")],
                                   cwd=temp, env=env, text=True, capture_output=True)
            result["buildSeconds"] = time.perf_counter() - build_start
            result["buildLog"] = build.stdout + build.stderr
            assert build.returncode == 0, result["buildLog"]
            original_lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
            used_lock = tomllib.loads((crate / "Cargo.lock").read_text(encoding="utf-8"))
            old = {(p["name"], p["version"], p.get("checksum")) for p in original_lock["package"]}
            used = {(p["name"], p["version"], p.get("checksum")) for p in used_lock["package"] if p.get("source")}
            assert used <= old, "Standalone build resolved a different dependency"
            result["dependencyVersionsMatchProductionLock"] = True
            exe = temp / "target/release" / ("news-terminal-v04-native-probe.exe" if os.name == "nt" else "news-terminal-v04-native-probe")
            data_dir = temp / "synthetic-only"
            data_dir.mkdir()
            with subprocess.Popen([str(exe), str(data_dir), str(args.trials), str(args.warmups), "smoke" if args.smoke else "full"],
                                  cwd=temp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as process:
                for line in process.stdout:
                    record = json.loads(line)
                    result["records"].append(record)
                    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
                    print(f'{record["kind"]}: {record.get("name", record.get("scenario"))} {record.get("trial", "")}', flush=True)
                stderr = process.stderr.read()
                assert process.wait() == 0, stderr
            result["summary"] = summarize(result["records"], args.trials, 1 if args.smoke else 7)
        result["sourceHashesAtEnd"] = hashes()
        result["changedDuringRun"] = [p for p in INPUTS if initial[p] != result["sourceHashesAtEnd"][p]]
        assert not result["changedDuringRun"], "Source changed during run; do not treat as stable evidence"
        result["temporaryFilesRemoved"] = not temp.exists()
        assert result["temporaryFilesRemoved"]
        result["verified"] = True
    except BaseException as exc:
        result["failure"] = str(exc)
        raise
    finally:
        result["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Verified evidence: {output}")


if __name__ == "__main__":
    main()
