# 0.4 exact-semantics single-source ranking

## Outcome

`src-tauri/src/intelligence.rs` now returns the already filtered/scored/sorted vector directly when all retained articles have the same normalized source key. The single-source diversity stage is linear rather than repeatedly scanning/removing from the remaining vector. Sorting and scoring are unchanged; this is not a claim that the entire rank function is linear.

The native synthetic 10,000-row one-source case (including 5,000 older saved stories) measured **2,428.7 → 38.9 ms** median rank time. The ratio of these historical-run medians is **62.37×**. The 5,000-row one-source case measured **554.4 → 21.5 ms**, a **25.78×** ratio. These are measured standalone Rust function results, not forecasts, installed-application latency, or real-feed guarantees.

## Exact behavior and intentionally unchanged scope

- Detection occurs **after** the existing preference filtering, scores/reasons and stable sort. The key is `sourceId.as_str().unwrap_or("")`, exactly as in the old counts map: missing, null, non-string and empty keys belong to the same bucket.
- For zero-based output index `count`, evaluate the original floating-point expression `(((count + 1) as f64) * cap).ceil() as usize`. Append the exact existing relaxation message iff `count >= allowed`. Do not assume that only the first story avoids relaxation; caps near one have different eligible prefixes.
- The sort order, score, reasons and their order, all unrelated article fields, saved-item filter bypass, and every retained item remain intact. No cache ceiling is added. Empty input still returns empty.
- The mixed-source greedy selector is unchanged apart from test-only instrumentation and its corrected comment. Mixed-source skewed tails can still be quadratic; this change does not solve them.
- No database/frontend/shared Cargo file, dependency, original before evidence, or prior release artifact was edited by this task. No final application release build was run. The existing native benchmark script is unchanged.

## Test-first record

The new `src-tauri/tests/v04_ranking.rs` freezes the complete pre-optimization rank implementation and its filtering helpers as a test-only oracle. It compares **entire `Vec<Value>` outputs**, not just IDs or counts. The first run, before production changes, passed five characterization tests. That passing characterization run is **not** represented as TDD RED.

A separate deterministic complexity regression then counted actual diversity-candidate visits using `#[cfg(test)]` thread-local instrumentation. Before the fast path, it failed at **128 rows / 8,129 visits**, against a bound of **256**. This was the actual RED; no wall-clock threshold is used. After implementation, all six tests passed. Detection and the legacy candidate scan both increment the counter, which is absent from normal/native benchmark builds.

Coverage includes empty/single/many input, caps 0.1/0.5/1.0 plus zero, negative, above-one, default/invalid values and later-added 0.75/0.9 cases; score/date/ID ties; missing/invalid dates and normalized source keys; all preference categories; duplicate topic/keyword preferences; saved bypass; filtering a mixed collection down to one source; mixed-source balance/skew; and a 5,103-row parity case retaining all 103 saved-overflow rows. The native benchmark separately verifies 10,000/20,000 returned rows and 5,000/15,000 saved overflow.

Actual commands from repository root:

```bash
# Initial characterization: five tests passed before optimization.
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test v04_ranking
# Actual RED, after adding only test instrumentation and its regression:
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test v04_ranking single_source_diversity_candidate_work_is_linear
# GREEN and subsequent integration verification:
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test v04_ranking --test backend
cargo clippy --offline --locked --manifest-path src-tauri/Cargo.toml --test v04_ranking -- -D warnings
rustfmt --check --edition 2021 src-tauri/src/intelligence.rs src-tauri/tests/v04_ranking.rs
```

Integration result: **24 backend tests + 6 ranking tests passed**; focused strict Clippy and rustfmt passed. This is not a claim that the complete application suite or all-targets Clippy ran in this task. Logs: [RED](evidence/v04-performance-after-ranking-red.txt), [first GREEN](evidence/v04-performance-after-ranking-green.txt), [integration](evidence/v04-performance-after-ranking-integration.txt), [final focused Clippy](evidence/v04-performance-after-ranking-clippy-final.txt).

## Native measurements

Milliseconds, median of nine measured trials after two warmups. Rank after range is minimum–maximum, not a confidence interval.

| Scenario | Returned rows | Rank before | Rank after [range] | Snapshot before | Snapshot after |
|---|---:|---:|---:|---:|---:|
| small / 19 sources | 500 | 0.975 | 0.930 [0.894–1.013] | 5.3 | 5.2 |
| ceiling / 19 sources | 5,000 | 22.1 | 21.0 [18.3–23.2] | 93.9 | 93.7 |
| retained-unsaved / 19 sources | 5,000 | 21.6 | 21.7 [19.3–23.5] | 117.3 | 123.1 |
| saved-5000 / 19 sources | 10,000 | 44.3 | 42.6 [41.1–50.3] | 182.4 | 182.9 |
| saved-15000 / 19 sources | 20,000 | 99.1 | 94.1 [92.3–97.4] | 372.8 | 357.3 |
| single-source | 5,000 | 554.4 | 21.5 [20.1–22.9] | 621.6 | 92.1 |
| single-source-saved | 10,000 | 2,428.7 | 38.9 [38.3–41.2] | 2,528.6 | 180.0 |

Balanced controls do not show a uniform improvement; no balanced-source optimization is claimed. Per-scenario dimensions, returned counts, encoded bytes, query plans and relaxation counts match the retained before evidence. Single-source relaxation counts remain **4,999 / 9,999**. Equal encoded byte counts alone do not prove across-run JSON equality; the frozen-legacy Rust tests provide full-output ranking parity checks.

Primary after evidence: [v04-performance-after-isolated.json](evidence/v04-performance-after-isolated.json). Run: **2026-09-24 07:45:05–07:47:05 UTC**, including a **36.2-second** standalone build. All **63 sample records / 504 operation timings** and all scenario checks passed. [Programmatic comparison](evidence/v04-performance-after-comparison.json) recomputes median/min/max/n from both persisted datasets and checks unique trials, fixture invariants, environment and script identity. [Additional checks](evidence/v04-performance-after-checks.json) reject missing/duplicate samples and tampered medians, verify that filtering/scoring/sort and the mixed selector match the frozen legacy code, and confirm that the current ranking source matches the measured fingerprint.

### Concurrent-edit issue and reproducibility

Three ordinary benchmark attempts completed timings but correctly **failed** the original end-of-run source-stability check because another task edited `db.rs` and/or `App.tsx`. Their retained files are `v04-performance-after-native.json`, `v04-performance-after-native-stable.json`, and `v04-performance-after-native-verified.json`. Despite their attempted filenames, **none is verified and none supplies the table above**.

The successful run uses a small evidence-only [wrapper](evidence/v04-performance-after-run.py): capture the listed benchmark inputs and unchanged script byte-for-byte into a temporary tree, verify no change during capture, and execute the original harness there. The original harness's source-stability check remains enabled. The wrapper fingerprints every captured input, records later live-checkout changes, and verifies deletion of both temporary trees. `App.tsx` changed in the live checkout during this run; it was not executed and could not change the frozen benchmark inputs. No application/user database was copied. `GIT_DIR`/`GIT_WORK_TREE` only allow the original read-only `git rev-parse HEAD` metadata command; no Git state changes.

Reproduce with fresh evidence names (existing outputs are refused):

```bash
python docs/evidence/v04-performance-after-run.py --output docs/evidence/v04-performance-after-rerun.json
python docs/evidence/v04-performance-after-compare.py --after docs/evidence/v04-performance-after-rerun.json --output docs/evidence/v04-performance-after-rerun-comparison.json
# The successful comparison was produced by:
python docs/evidence/v04-performance-after-compare.py --output docs/evidence/v04-performance-after-comparison.json
```

### Comparison limits

The [original baseline](v04-performance-baseline.md) method still applies: offline copied-lockfile standalone release `opt-level=3`, synthetic fresh file-backed SQLite with read-only measurement, fixed time/default cap 0.5, input cloning excluded from rank timers, no model/network/user-data access, and no Tauri IPC/GUI/lock-wait/OS-cold-cache measurement. Registry dependency versions/checksums matched production; temporary artifacts were removed.

Both retained runs have the same machine/toolchain metadata and byte-identical benchmark script. However, these are sequential historical runs, **not an interleaved one-variable A/B experiment**: production `db.rs`, `intelligence.rs` and the informational `App.tsx` fingerprint differ. Other development processes were not suspended. Snapshot changes cannot all be causally attributed to ranking from this comparison alone. Small balanced-case differences should be treated as variation, not gains. There is no p95 claim, timing-based CI gate, or universal speedup claim.
