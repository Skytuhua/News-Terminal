# v0.5 backend: bulk article state and alert delivery receipts

Host half of the accepted 0.5 scope: **C (bulk triage)** and **D (alert delivery visibility)**. Renderer work for both, plus A, B, E, F and G, belongs to the concurrent frontend slice. No schema migration, no dependency change, no retention-policy change, no version or release-artifact edit.

## Implemented contract

### `article_state_many`

```ts
{ op: 'article_state_many', profileId: string, replacementToken: string,
  items: [{ articleId: string, read?: boolean, saved?: boolean, hidden?: boolean }] } -> null
```

- **`profileId` is required and has no implicit `default` fallback.** This is a deliberate divergence from `article_state`, which resolves a missing `profileId` to `default`. A bulk write dispatched while a different profile is active must fail closed, not silently land on `default`; the whole point of the operation is that one dispatch moves many rows, so a mis-scoped batch is the most expensive possible mis-scope. Unknown, empty, oversized (over 200 bytes), null and wrong-typed profile IDs are rejected.
- **`replacementToken` is required and checked first**, exactly like every other guarded write. A stale, empty, absent, null or non-string token fails with the existing `"Database replaced: reload before making a new change"` and writes nothing. The batch and the single-article path return the identical error for the identical stale token.
- **The single-article guards are reused by construction, not reimplemented.** `article_state`, `group_split` and `article_state_many` all call the same private `Database::write_article_state`, so the `boolean()` validation, the 10,000-saved cap, the `Unknown article` check, the `read` → `saved` → `hidden` application order and the state-row upsert are literally the same code. A multi-key item in a batch cannot drift from the single path.
- **Key order is fixed at `read`, then `saved`, then `hidden`.** JSON object key order in the request is irrelevant. This is observable: an item whose `read` and `hidden` are both non-boolean fails on `read`, because `read` is validated first. `groupId` and any other stored key are preserved; the batch never writes `groupId`, so a split performed by the single path survives a later batch.
- **Unknown keys inside an item are ignored**, exactly as unknown keys in a single `article_state` request are ignored. The batch does not invent stricter rules than the operation it replicates. A non-object item, or one without `articleId`, is rejected with `"Missing or invalid articleId"`.
- **The whole batch is rejected on any unknown `articleId`, with no partial write.** All items run inside one `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, so an unknown id at the first, middle or last position leaves the database byte-identical to its pre-batch export. This is the difference between a rejected action and a desynchronised renderer, so it is enforced structurally rather than by a pre-scan.
- **Batch bound: 1 to 200 items** (`MAX_ARTICLE_STATE_BATCH`). 200 covers a full mounted page of 100 rows with headroom for a future larger page size, while keeping the write transaction short enough that it cannot monopolise the database writer lock against a concurrent refresh. Because the whole batch is one transaction, the bound is also what makes whole-batch rejection cheap. An empty batch and a non-array `items` are errors, not silent no-op successes.

**Why the bound is 200 and not 5,000.** The renderer selection is scoped to the mounted page, which is 100 rows. A bound at or near that size cannot be hit by the intended use, so it exists as a real guard against a runaway loop rather than as a limit the feature will hit. A much larger bound would lengthen the single `BEGIN IMMEDIATE` window and therefore increase the chance that a bulk triage write interleaves badly with a scheduled refresh, for no user-visible benefit.

### `alert_receipts`

```ts
{ op: 'alert_receipts', profileId: string, limit?: number }
  -> [{ profileId, articleId, at, title | null }]
```

- Reads the existing `alert_log` table, which already backs the delivery deduplication receipt (`db.rs` `claim_alerts`) and is already pruned at 90 days by `retain`. **No new table, no new write, no new retention rule.**
- **Profile-scoped by SQL predicate**, not by post-filtering: `WHERE l.profile_id = ?1`. Another profile's receipts for the same article id, and receipts for articles that exist only in another profile, are never returned. A missing or unknown `profileId` is rejected rather than defaulted.
- **Newest first**, `ORDER BY l.at DESC, l.article_id ASC`. The secondary key makes the order deterministic when two receipts share a timestamp, which a 60-second deduplication window makes likely.
- **Bounded.** Default 50, hard ceiling 200 (`MAX_ALERT_RECEIPTS`). An explicit `limit` must be a whole number of at least 1; `0`, negative, fractional, string, boolean and null are errors. A larger-than-ceiling `limit` is clamped rather than rejected, because a caller asking for more should get the maximum, not a failure.
- **Retention is the existing 90-day policy, applied as a read predicate** (`l.at >= now - 90*86400`) matching `retain`. A receipt the retention policy has already expired is never surfaced, even before the next prune runs. Retention itself is unchanged.
- **Exposes no other profile's data and no secrets.** Each receipt is exactly `{profileId, articleId, at, title}`. `title` comes from a `LEFT JOIN` on the local article row purely so a human can recognise the delivery; a receipt whose article has since been pruned returns `title: null` rather than fabricating one. No source URL, no excerpt, no provider or credential material, and no cross-profile state is included.

## Events and summary invalidation

- `alert_receipts` is added to the `changed()` exclusion list in `src-tauri/src/lib.rs`. Reviewing receipts must not emit `data-changed` and trigger the subscribed views to reload themselves.
- `article_state_many` is **not** excluded: a bulk triage write is a change and must emit `data-changed`.
- A batch in which any item carries `hidden` cancels in-flight summaries before the write, mirroring the existing single-article hide path, so a summary cannot keep quoting a story the user just hid. A batch that only sets `read` or `saved` does not cancel: it cannot invalidate a summary's grounding, and cancelling would drop user work for no reason.

## Test-first execution record

Each production behaviour below was preceded by an observed failing test. Where a test passed on first run because an earlier cycle had already produced the behaviour, the test was **mutation-checked**: the implementation was deliberately broken and the test was confirmed to fail, so the assertion is known to be load-bearing rather than incidental.

| Cycle / test | Observed RED | GREEN or mutation result |
|---|---|---|
| `article_state_many_matches_single_article_state_for_one_item` | `Err("Unknown article")` with the batch request falling through to the single-article arm (re-confirmed against stashed, unmodified `db.rs`) | Extracted `write_article_state`; both paths call it |
| `article_state_many_applies_multi_key_items_in_read_saved_hidden_order` | `left: "Unknown operation"`, `right: "Expected boolean"` | Shared write path fixes the order; `groupId` preservation proven |
| `article_state_many_rejects_the_whole_batch_on_an_unknown_article` | Passed on first run (the cycle-1 transaction already covered it) | **Mutation-checked:** removing the transaction made the first item's `read:true` persist while the batch reported `Unknown article` |
| `article_state_many_is_bounded_and_never_partially_writes` (300+ real article rows, bound 200) | Passed on first run | **Mutation-checked:** raising `MAX_ARTICLE_STATE_BATCH` to 100,000 failed the fixture-exceeds-bound assertion |
| `article_state_many_is_profile_scoped_and_never_writes_another_profile` | A missing `profileId` was accepted and written to `default` | `article_state_many` now requires an explicit `profileId` |
| `article_state_many_fails_closed_on_a_stale_or_missing_replacement_token` | Passed on first run | **Mutation-checked:** deleting `require_replacement` from the batch arm failed the stale-token assertion |
| `alert_receipts_returns_only_this_profiles_deliveries_newest_first` | `Unknown operation` | Profile-scoped, bounded, newest-first read; shape asserted key-by-key |
| `alert_receipts_honour_the_existing_ninety_day_retention` | `Unknown operation` | 90-day read predicate; pruned-article receipts report `title: null` |
| receipts profile isolation | **Mutation-checked:** dropping `l.profile_id=?1` from the query returned 5 rows instead of 3 | Isolation is enforced by SQL, not post-filtering |
| `alert_receipts_is_read_only_for_change_events` | `!changed("alert_receipts")` assertion failed | Added to the `changed()` exclusion list |
| `batch_hide_cancels_active_summaries_like_the_single_article_path` | A batched hide left the registered summary cancellation flag unset | Added the `article_state_many` hidden-carrying arm in `Backend::execute` |

Two fixture bugs were found and fixed while establishing RED, and are recorded here because they nearly produced a false pass: article ids are derived from the canonical URL, not from the feed's `id` field, so a batch built from feed labels addresses nothing; and `serde_json::Value` objects are `BTreeMap`-backed, so a receipt-shape assertion must compare sorted key sets rather than a literal key order.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test backend --test backend_limits
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
rustfmt --edition 2021 --check --config skip_children=true src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/tests/backend.rs src-tauri/tests/backend_limits.rs src-tauri/tests/host/unit.rs
```

- Focused run: `cargo test --test backend --test backend_limits --lib` — **143 + 31 + 4 passed, 0 failed**.
- Full Rust run: **276 passed, 0 failed, 19 ignored** across 33 test binaries. The 19 ignored tests require explicit network, live-model, keyring or fixture-server setup and were not run.
- Strict all-target Clippy (`-D warnings`) and the scoped Rust 2021 rustfmt check both exited **0**.
- Every RED cycle exited non-zero for the expected reason (missing operation, or a specific guard accepting a request it must reject); every GREEN cycle exited **0**.

**Environment note, not a test result.** An intermediate full-suite attempt failed with `E0786` / `E0463` and a compiler ICE. The cause was environmental, not a source defect: a run had been pointed at a fresh `CARGO_TARGET_DIR`, forcing cargo to build a second complete copy of the Tauri/reqwest/image dependency tree while other cargo builds were already resident, and the Windows pagefile was exhausted (`os error 1455`, "failed to mmap file"). After dropping the custom target dir and serialising the final run with `-j 2` against the project's normal `src-tauri/target`, the full suite passes as reported above. No code was changed in response to those errors.

The generic file-edit lint hook incorrectly attempts Rust 2015 parsing for `async` modules in this repository. Real Cargo builds and the explicit Rust 2021 formatting check are the authority; no source workaround or edition/config change was made.

## Scope and evidence limits

Modified only `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/backend.rs`, `src-tauri/tests/backend_limits.rs`, `src-tauri/tests/host/unit.rs` and this document. No frontend, version, packaging, release, migration, dependency or user-data change. No commits.

This proves the host contract, the guards, the whole-batch rejection, the bounds and the profile isolation. It does **not** claim renderer behaviour (one dispatch per action, selection lifetime, count-honest hide banner), native-window acceptance, live notification delivery, or a release build. The `notification-status` subscription and the receipts surface are renderer work in the concurrent slice; this slice only adds the read that backs it and the event classification it depends on.
