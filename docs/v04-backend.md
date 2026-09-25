# v0.4 backend: retained hidden stories and narrow workspace reads

## Implemented contract

Both operations go through the existing host/database dispatcher. `profileId` is required, must be a nonempty string of at most 200 bytes, and must identify an existing profile. Neither operation defaults to `default` when the field is absent. Missing, null, wrong-type, empty, oversized and unknown profile IDs return an error.

### `hidden_stories`

```ts
{ op: 'hidden_stories', profileId: string } -> Article[]
```

- Reads `states JOIN articles`, scoped to the requested profile with `json_extract(states.data, '$.hidden') = 1`.
- Returns **all retained matching articles**, ordered by `firstSeen DESC, id ASC`. This is newest retrieved first, not recently hidden.
- Uses the existing `read_articles` overlay for `read`, `saved`, `hidden`, and `groupId`. No other profile's state is imported.
- Does not call ranking, apply relevance preferences, or apply the ordinary snapshot/search 5,000-row cap. It does not widen or otherwise change the ordinary snapshot.
- Does not mark read, create state, fetch media, invoke AI, or change retention. Restore still uses only `{op:'article_state', profileId, articleId, hidden:false}`; the existing merge preserves other flags and group state.
- Recovery ends when the article is deleted. Hidden alone does not protect against age/cache-size pruning. A save in any profile still provides the existing retention protection.

### `workspace_get`

```ts
{ op: 'workspace_get', profileId: string } -> Workspace
```

Returns the workspace object directly, **not** `{workspace: ...}`. It uses the same `require_profile` / `get("workspace", id, "")` / default workspace fallback as `snapshot.workspace`, including the authoritative revision. No article query, hydration, or ranking is performed; the fallback does not persist a document.

The intended frontend use is only the workspace revision pre-read. Existing `workspace_save` expected-revision compare-and-swap, conflict/retry, and authoritative post-write snapshot confirmation remain unchanged. Renderer profile/import generations and detached ownership are not replaced by this endpoint.

### Events and compatibility

Both operations are explicitly excluded by `changed()` in `src-tauri/src/lib.rs`; they must not emit `data-changed` and trigger subscribed views to reload themselves. Existing state/workspace writes remain classified as changes.

Workspace validation now accepts tab mode `hidden` alongside `all`, `saved`, `brief`, `watchlist`, `briefing`, and `live`. The same validator is used by backup import/export. No schema or backup-version migration was added. Existing modes and old backups remain accepted. **Older 0.3 binaries may reject a newer backup containing a `hidden` tab**; forward compatibility with those binaries is not claimed.

## Test-first execution record

Each production change below followed a separate observed failing test, minimal implementation, then passing focused rerun. They were not implemented as a batch after writing all tests.

| Slice / test | Observed RED | GREEN change |
|---|---|---|
| `hidden_stories_persist_and_are_profile_scoped` | `Unknown operation` after closing/reopening a real temporary SQLite database | Scoped retained-hidden query using the existing state overlay |
| `hidden_stories_requires_an_explicit_valid_profile` | Missing profile was accepted by the legacy dispatcher default | Require explicit profile ID at this endpoint |
| `hidden_stories_is_read_only_for_change_events` | `!changed("hidden_stories")` assertion failed | Read-only event classification |
| `workspace_get_matches_snapshot_across_cas_reopen_and_import` | `Unknown operation` | Existing workspace/profile getters, direct response |
| `workspace_get_requires_an_explicit_valid_profile` | Missing profile was accepted | Require explicit profile ID at this endpoint |
| `workspace_get_is_read_only_for_change_events` | `!changed("workspace_get")` assertion failed | Read-only event classification |
| `hidden_workspace_mode_persists_and_roundtrips_with_legacy_modes` | `Invalid tab mode` | Add `hidden` to the existing validator |

Two additional boundary guards passed against those minimal implementations without requiring more production changes:

- `hidden_stories_cover_retained_overflow_without_preferences_or_state_leakage`: 5,002 hidden rows; deterministic retrieval-time and ID tie order; ordinary snapshot remains capped; preference-excluded unsaved entries remain recoverable; other-profile saves do not leak flags; another profile's saves protect old rows; unprotected hidden rows disappear on size/age pruning; remaining results survive reopen.
- `workspace_get_uses_default_fallback_without_reading_articles`: deletes the workspace document in a disposable fixture, compares the fallback with snapshot, then drops only that fixture's articles table. Snapshot fails while repeated workspace-only reads still return the same object without recreating the workspace document. This is a dependency-boundary check, not a benchmark.

The persistence test also compares exports before/after repeated reads, restores with only `hidden:false`, and verifies unchanged saved/read/group state after another reopen. Workspace tests verify exact JSON-value equality, revision changes, stale-CAS rejection and retry, profile isolation, reopen and backup roundtrip. Existing full-suite detached-ownership and import reconciliation checks also passed; no new native-window test was performed by this backend task.

## Actual verification

Executed from the repository root using existing dependencies and temporary/in-memory databases:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test backend --test backend_limits
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
rustfmt --edition 2021 --check --config skip_children=true src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/tests/backend.rs src-tauri/tests/backend_limits.rs src-tauri/tests/host/unit.rs
```

- Focused integration suites: **24 backend + 3 backend_limits passed**.
- Full Rust run at verification: **211 passed, 15 ignored, 0 failed**. This includes the concurrently implemented ranking tests present in the shared checkout; this task did not author or modify ranking files. Ignored tests require explicit network, live-model, keyring, or fixture-server setup and were not run.
- Strict all-target Clippy and the scoped Rust 2021 rustfmt check exited **0**.
- Individual RED commands exited **101** with the failures listed above; their corresponding GREEN commands exited **0**.

The generic file-edit lint hook incorrectly attempts Rust 2015 parsing for async modules. Real Cargo tests and explicit Rust 2021 formatting checks succeeded; no source workaround or edition/config change was made.

## Scope and evidence limits

Modified only `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/backend.rs`, `src-tauri/tests/backend_limits.rs`, `src-tauri/tests/host/unit.rs`, and this document. No dependencies, production data, frontend, ranking, versions, release artifacts, commits or pushes were changed by this task.

This proves the backend contract and regression behavior. It does not claim measured endpoint IPC speedup, frontend race handling, native visual/restart acceptance, live-service verification, or a release build. The earlier performance baseline motivates the narrow getter but is not a measurement of this new endpoint.
