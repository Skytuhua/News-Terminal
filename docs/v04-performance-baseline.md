# 0.4 native performance baseline — production 0.3 functions

## Decision

**Repeated full snapshots for workspace-only reads are a measured avoidable cost; source-concentrated diversity ranking is the measured worst-case native bottleneck.** Neither follows from the older browser-only baseline alone.

- Balanced 5,000-row cache: full snapshot **93.9 ms**, article SQL/decode/state merge **40.5 ms**, ranking **22.1 ms**. Ranking is not the largest measured isolated component here.
- Balanced 20,000-row snapshot, including 15,000 older saved stories: **372.8 ms** per snapshot; three workspace-only full reads **1,253.7 ms**. The direct existing profile/workspace getters average about **0.011 ms/read** in 100-read batches, returning exactly the same workspace/revision.
- One-source 10,000-row snapshot, including 5,000 older saved stories: ranking **2,428.7 ms**, snapshot **2,528.6 ms**, three workspace-only full reads **7,714.8 ms**. This is a synthetic concentration stress case, not a claim about the user's feed mix.

**Smallest generally useful next change:** add a profile-validated workspace-only read, use it for `workspaceIntent`'s revision pre-read, retain compare-and-swap writes and authoritative post-write snapshot confirmation. Do not add a general snapshot cache, change retained/saved data, or rewrite the database architecture. Separately, the single-source ranking stress now warrants an exact-semantics fast path, not a speculative whole ranking rewrite.

No application source, shared Cargo manifest/lockfile, tests, 0.3 distribution, production database or model service was modified. No final application release build was run.

## Evidence and reproduction

- Harness: [`../scripts/v04-native-performance.py`](../scripts/v04-native-performance.py).
- Raw samples, summaries, query plans, build log and input fingerprints: [`evidence/v04-performance-native.json`](evidence/v04-performance-native.json).
- Independently recomputed aggregation, input/evidence checksums and negative harness checks: [`evidence/v04-performance-verification.json`](evidence/v04-performance-verification.json).
- Primary run: **2026-09-24 07:21:01–07:25:58 UTC**, including **42.1 seconds** building the standalone probe. Seven scenarios; two discarded warmups plus nine measured trials each; **63 sample records / 504 operation timings**, all assertions passed. No p95 claim from this sample size.

From the repository root, with the already-cached Rust dependencies and Python 3.11+:

```bash
# Full rerun: output is deliberately never overwritten.
python scripts/v04-native-performance.py --output docs/evidence/v04-performance-rerun.json
# Small native smoke; not a replacement for the overflow/concentration cases.
python scripts/v04-native-performance.py --smoke --trials 3 --warmups 1 --output docs/evidence/v04-performance-smoke.json
```

Only the full command without flags was used for the primary timing run. The smoke command above is a provided reproduction option, not an additional claimed run.

### Isolation and method

The script creates a new `TemporaryDirectory` under the system temp directory. It copies the actual production `db`, `intelligence`, `rights`, `media`, `services`, `briefing` and `sector_summary` modules, the database backup submodule, schema and compiled source catalog. It appends measurement accessors **only to the temporary `db.rs` copy**; existing production function bodies are unmodified. The measured snapshot and search operations execute the current `Database::request`; ranking executes the current `intelligence::rank`; article-stage measurement exposes the current private `articles`; the narrow workspace comparison calls the current `require_profile` and `get` plus existing default fallback.

A standalone Cargo crate omits Tauri, uses `--offline`, release `opt-level=3`, and its own temporary `CARGO_TARGET_DIR`. The copied lockfile may be pruned for this smaller root package; the harness asserts that **every resolved registry package/version/checksum is present in the production lockfile**. No dependency is added to the application or downloaded. There is no Tauri build script, GUI, model call, feed request, keyring operation, or listener. Merely compiling supporting production modules does not execute their network/provider functions.

Every scenario creates a fresh file-backed SQLite database with `Database::open`, production schema, WAL and FTS triggers. Seeding is a deterministic transaction directly into that synthetic database, **not timed ingestion**. Catalog source documents are replaced with fixture sources. All measurement operations run after `PRAGMA query_only=ON`. Temporary databases, copied sources, standalone executable and target artifacts were successfully removed after the run. Only the owned script/report/evidence remain.

Environment: Windows build **10.0.26200**, AMD64 Family 26 Model 36 Stepping 0, **24 logical CPUs**; Python **3.11.15**; Rust/Cargo **1.97.1**; bundled SQLite **3.50.2**. The graph report was read first; its recorded commit and checkout HEAD are `a85405469939361f2512266ee3f4b21240ac7e8e`. Since application files are untracked in this checkout, HEAD alone is not a build identifier. Raw evidence fingerprints all copied modules, schema, catalog, Cargo files and the inspected `App.tsx`; all fingerprints remained unchanged throughout the run.

This is a standalone native-function benchmark, not the installed executable. A read-only `cargo tree --offline --locked -e features -i serde_json` check found production runtime JSON features `default`, `std`, `raw_value`, with no `preserve_order`; the smaller probe does not include Tauri's `raw_value` feature. It measures normal `Value` documents, not `RawValue`/Tauri serialization. Full Tauri dependency-feature unification and binary layout are not asserted identical.

### Synthetic data and timing boundaries

- Fixed time `1790184000`; default profile preferences, diversity cap **0.5**, no topic/source/keyword exclusions. Deterministic minute-spaced timestamps; newest item index zero.
- Balanced sources alternate across 19 sources; concentrated scenarios have exactly one source. All rows contain short repeated permitted synthetic excerpts, empty history/media, explicit false AI permission, three-item group labels and deterministic read state. The domain is `example.invalid`; nothing is fetched.
- The newest 5,000 rows are not saved; designated older rows are saved. Each row also has a separate `other` profile-ID state marked saved, to verify the default-profile SQL join does not import another profile's saved state. This auxiliary state key is not a second active application profile.
- A `needle` token occurs every tenth row. `Synthetic` occurs in every title. Search validates the exact newest IDs and the 5,000-result limit, not just elapsed time.
- Per-scenario first post-seed snapshot is recorded separately and **excluded from the warm summary**. It is not an OS-cold or fresh-process measurement: seeding has just warmed the database. OS caches are not cleared.
- Rust `Instant` measures each operation. Eight operation orders rotate across trials. Output validation and result destruction are outside individual operation timers. Rank-input cloning is outside `rank_ms`; it is a consumed vector in the real call. Snapshot timing includes the real `json!` assembly, not byte encoding; byte encoding is measured separately. Component medians are **not additive** and are not used to invent a precise residual allocation/clone attribution.
- Three-workspace-snapshot timing includes three sequential full reads and destruction of discarded article payloads, returning only workspace from each. It is a native amplification experiment, **not an observed count of UI reads per interaction or real multiwindow contention**. The direct workspace comparison is nine batches of 100 reads, reported per read; it is not a shipped endpoint or an IPC speedup claim.
- Other processes were not suspended. Keep the ranges, especially the repeated-read outlier at the 5,000-row ceiling. No CPU, allocator, memory-peak, battery, native-lock-wait or GUI-latency profile was collected.

## Native measurements

Milliseconds, **median, n=9**. Snapshot column also includes **[minimum–maximum]**; every individual sample and every operation's min/max are in the raw evidence. “Retained / saved overflow / sources” names the database shape; saved overflow is additional to the ordinary newest-5,000 window.

| Retained / saved overflow / sources | Returned rows | SQL + decode + state | Rank | Full snapshot [range] | Three workspace snapshots | Direct workspace/read |
|---|---:|---:|---:|---:|---:|---:|
| 500 / 0 / 19 | 500 | 2.7 | 1.0 | 5.3 [5.0–5.8] | 17.5 | 0.0101 |
| 5,000 / 0 / 19 | 5,000 | 40.5 | 22.1 | 93.9 [88.4–98.7] | 312.8 | 0.0111 |
| 20,000 / 0 / 19 | 5,000 | 65.5 | 21.6 | 117.3 [113.0–120.7] | 380.9 | 0.0111 |
| 10,000 / 5,000 / 19 | 10,000 | 76.9 | 44.3 | 182.4 [178.0–186.6] | 603.5 | 0.0111 |
| 20,000 / 15,000 / 19 | 20,000 | 147.7 | 99.1 | 372.8 [366.6–407.5] | 1253.7 | 0.0110 |
| 5,000 / 0 / 1 | 5,000 | 39.2 | 554.4 | 621.6 [617.0–658.7] | 1899.9 | 0.0106 |
| 10,000 / 5,000 / 1 | 10,000 | 72.7 | 2428.7 | 2528.6 [2482.9–2728.7] | 7714.8 | 0.0105 |

Search returns hydrated/state-merged rows without calling `rank` (`db.rs:1211–1213`). The broad search remains capped at 5,000 even when snapshots contain more. JSON encoding below is standalone `serde_json::to_vec`, not measured IPC wire time.

| Scenario | 10% FTS search, ms | All-match FTS search, ms | Snapshot JSON encode, ms | Encoded bytes |
|---|---:|---:|---:|---:|
| small | 0.5 | 3.9 | 0.7 | 405,728 |
| ceiling | 8.3 | 62.6 | 8.9 | 4,005,054 |
| retained-unsaved | 32.3 | 97.1 | 8.8 | 4,005,054 |
| saved-5000 | 16.8 | 73.7 | 17.8 | 8,007,121 |
| saved-15000 | 33.6 | 98.7 | 34.9 | 16,033,260 |
| single-source | 8.3 | 59.5 | 9.3 | 4,359,199 |
| single-source-saved | 15.8 | 70.4 | 17.9 | 8,721,532 |

## What the SQL and ranking evidence establish

1. **Saved overflow is real and must remain reachable.** The production non-search SQL (`db.rs:564–582`) returns newest 5,000 **OR** profile-saved items, with no outer limit. The measured 20,000-row result includes all 15,000 old saved IDs. The comment in `intelligence.rs:97` that the cache is bounded at 5,000 does not describe that query. Do not speed up ranking by dropping older saved stories.
2. **Retained rows cost work even when not returned.** With 20,000 retained and no default-profile older saves, the snapshot still returns 5,000, but article SQL/decode/state grows from **40.5 to 65.5 ms** and full snapshot from **93.9 to 117.3 ms**. Both production query plans scan the outer article index, join state by `(profile_id, article_id)`, scan the article subquery, and use two temporary ORDER BY B-trees. There is no firstSeen expression index in the schema. This justifies considering a narrow SQL/index experiment later, but no replacement SQL/index has been benchmarked here, so no benefit is claimed.
3. **Concentrated diversity selection is a proven bottleneck.** Holding rows at 5,000 changes rank from **22.1 ms** across 19 sources to **554.4 ms** for one source (**25.1×**). In the one-source case doubling returned rows to 10,000 increases rank to **2,428.7 ms** (**4.38×**). The actual loop (`intelligence.rs:94–117`) repeatedly searches remaining articles for an eligible source and removes from the vector. After the first story, the single-source fixture exhausts that search and adds a relaxation reason on every iteration: **4,999 / 9,999** relaxation rows, verified from production output. These are measured ranking costs with scaling consistent with the source-level quadratic risk, not a cycle-accurate attribution between scanning and vector movement.
4. **Workspace revision acquisition unnecessarily invokes these paths.** `App.tsx:287–315` obtains `latest.workspace` through `snapshot` before every queued workspace save, then performs the acknowledged-write load. `db.rs:1043–1045` rebuilds sources/documents/articles/ranking for that read. The direct profile/workspace getters return identical revision/state without loading any articles. The host has a shared database mutex (`lib.rs:152–157`); this makes repeated work relevant to other callers, but this probe deliberately does not measure mutex contention.
5. **FTS is not the worst measured case.** `needle` search is **8.3 ms** at 5,000 retained and **32.3–33.6 ms** at 20,000; all-match search is **62.6–98.7 ms** in the balanced cases. Its plan uses the FTS virtual table, a list subquery/Bloom filter, primary-key article lookups, state join and a temporary ordering B-tree. Broad search and hydration are measurable, but source-concentrated ranking is orders more expensive in the stress fixture. Do not replace FTS on this evidence.

## Minimal targeted proposals — not implemented

### 1. Narrow the workspace revision pre-read

Expose the existing `require_profile(id)` + `get("workspace", id, "")?.unwrap_or_else(workspace)` path as a profile-scoped, read-only operation. Replace **only** `workspaceIntent`'s full-snapshot pre-read. Keep the existing expectedRevision conflict/retry protocol and post-write authoritative readback; do not replace them with a renderer cache or optimistic revision increment.

Evidence supports removing the full-snapshot cost from that acquisition, including saved-overflow and concentrated ranking work. The direct getter timings do **not** mean the whole interaction becomes 0.011 ms; IPC, writes, post-write confirmation and renderer work remain. No general snapshot cache, new dependency, new persisted schema or stale-data invalidation system is needed.

Acceptance before shipping: workspace/revision equality; missing/invalid profile rejection; simultaneous-window CAS conflict/retry; import/profile-generation changes during acquisition; detached-tab ownership; authoritative article/permission updates after mutation. Rerun this native probe and existing workspace/race tests. The synthetic three-read experiment is not permission to remove required confirmation reads.

### 2. Avoid repeated unsuccessful diversity scans for single-source input

The smallest ranking change supported by these stress measurements is an **all-one-source fast path after the existing filter/score/sort**, consuming the sorted vector directly. Preserve the same per-prefix allowed count, relaxation test/message, reasons, scores and exact ordering. This avoids searching every remaining article when none can possibly be a new eligible source, without reworking the common mixed-source algorithm. Source-filtered profiles can legitimately create this case. Mixed-source skew/tails remain a separate measurement target; do not claim this fast path fixes every skewed collection.

Before implementation, add exact full-JSON equivalence tests against the current rank function over empty/single/many rows, saved overflow, caps 0.1/0.5/1.0, ties, filtered preferences and reason ordering. Re-run the measured one-source cases plus balanced controls. This report contains **no A/B optimized-rank implementation or forecast speedup**. Do not generalize the 25.1× original-versus-original fixture ratio into a promised optimization gain.

## Verification and scope

All seven databases passed SQLite integrity and foreign-key checks before/after measurement. Every timed result was checked: exact ID membership/uniqueness, read/saved state merge, other-profile state isolation, all older saved stories present, deterministic ranked IDs, full snapshot equality, search IDs/order/count/limit, workspace revision equality and JSON roundtrip. Final snapshots equaled initial snapshots. All measured dependency versions/checksums matched the application lockfile, all input/script hashes matched, and temporary artifacts were removed.

Aggregation was recomputed from the persisted JSON. Missing/duplicate records were deliberately rejected, as were too few trials, output outside the owned evidence prefix, and overwriting existing evidence. The original 0.3 browser evidence and application artifacts were not touched. No application regression suite or final release build is claimed by this read-only benchmarking task.

The mandatory research-capture rule points to `C:/Users/user/.Codex/rules/common/research-capture.md`; reading it returned file-not-found. No Mission Control write was attempted outside the explicitly owned files. Parent-agent follow-up can capture this report using an available established command. No production data or secrets appear in these artifacts.
