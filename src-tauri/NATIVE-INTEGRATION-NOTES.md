# Parent integration handoff (historical)

> The two native compilation blockers below were fixed by the parent, and the full host built and ran. Main-profile persistence and orphan ownership reconciliation also passed real Windows regression checks. This file preserves the initial agent handoff; current integration evidence is in `docs/windows-smoke-test.md` and `docs/evidence/native-smoke.json`. Independent-review corrections are being verified before final packaging.

## Initial native compile blockers (resolved)

Full `cargo test --test host --test backend` currently fails only in `src/native.rs`:
- line 63: `fs::rename(...).map_err(|_| "Could not replace window layout")` returns `Result<(), &str>`; change the error literal to `.to_string()` or use `?; Ok(())`.
- lines 246-249: terminal `if let Ok(mut layout) = state.layout.lock() { ... }` needs a trailing semicolon to drop the temporary before `state`.

Backend agent did not touch native.rs/native_geometry.rs/services.rs. All host integrations are wired: `native::setup`, `native::handle`, native profile/tab validation, opener + notification plugins, NEWS_TERMINAL_DATA_DIR override, source scheduler, alert delivery, data-changed events, async services, cancellation. `dispatch` is private at crate root because Tauri's public-command macro there creates duplicate macro exports.

## Verification

- RED/GREEN slices executed for database defaults, profile isolation/stable visit, ingestion/history/FTS/state, workspace revision conflicts/watchlists, rankings/diversity/group splitting, quiet hours/rate limiting/dedup, atomic backup validation/retention, source backoff, provider secret stripping/catalog, metadata-only import rejection, strict IPC fields, saved stories outside the recent cache.
- Main Cargo backend suite passed 9/9 before wiring the parent native module.
- Standalone `cargo test --manifest-path core-tests/Cargo.toml --target-dir target/core-tests`: **16 backend tests passed** after native compilation became blocked. This harness uses the exact production db.rs + intelligence.rs + backend.rs tests, no alternate implementation. Production still has normal Tauri dependencies and no desktop feature bypass.
- `cargo clippy --manifest-path core-tests/Cargo.toml --target-dir target/core-tests --all-targets -- -D warnings`: exit 0.
- Owned Rust files rustfmt formatted without traversing parent/services modules.
- Host integration tests in tests/host.rs observed RED. GREEN currently blocked by the two native compile errors above. Re-run main `cargo test` after parent fixes.

## Behavior/limits

- Canonical source-scoped IDs preserve all original sources. FTS5 local phrase-token search. Feed revisions max 20; invalid ingestion batch is atomic. Metadata-only sources discard excerpts. Source aiAllowed is enforced again at summary dispatch.
- Global English profile, no machine/IP locale inference. Preferences deterministic with reasons and source-cap sparse-coverage explanation. Saved articles remain accessible even if excluded by recommendations.
- 32 profiles, 100 sources, 100 watchlists/profile, 50 tabs/workspace, 1,000 items/feed, 16,000-byte excerpt bound, 5,000 recent cached articles; new save operations capped at 10,000 globally (backup imports bounded separately at 15,000 total articles). Unsaved retention 30 days, alert dedup retention 90 days. Backup/import 32 MiB; all references/field shapes/policies validated before transaction.
- workspace_save accepts expectedRevision or workspace.revision and rejects stale writes; snapshot revisions monotonic per save. User must reload on conflict.
- Refresh scheduler is app-running only, checks every 60 seconds, fetch concurrency 4. Source refreshMinutes respected even for manual refresh; Retry-After enforced. No tray/background-after-exit claim.
- Alert quiet time uses actual local instant each delivery (DST/timezone changes honored), overnight intervals, opt-in per profile/watchlist, max 3 notifications/profile/10 min, only newly-seen items within 5 minutes. Records claims before OS delivery for at-most-once behavior; unavailable notification error emitted, in-app stories preserved.
- Import disables all AI providers/consent; user must opt in again. Keys only services OS keyring, never DB/export.
- First opening an existing v0 DB creates a SQLite backup before migration; newer schema versions fail safely. Native window JSON is separately parent-owned, not part of DB export.

No commits or pushes. Initial Windows resource build needed icons/icon.ico; a valid plain dark 32px icon was generated in that owned path. Cargo.lock is generated. Parent may replace icon with product artwork.
