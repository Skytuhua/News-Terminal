# Focused implementation verification

Updated: 2026-09-25 UTC.

> Historical implementation handoff, not current release approval. Subsequent integration checks exposed regressions, so the pass counts below describe the earlier implementation snapshot only. The parent has since fixed the native IPC probe (`__TAURI_INTERNALS__`), successfully fetched live focused news, and obtained a clean npm audit. Model/benchmark and automatic-thumbnail components were subsequently revised. The current full-suite, installer, and native reruns are in progress; do not treat this report as evidence that those revisions passed. Stocks-image reuse rights and the three-publisher focused-thumbnail gate remain unresolved. No GitHub publication is claimed.

This report maps the approved 15-task focused free-news plan to implemented files and verification evidence. It is intentionally conservative: a blocker is not counted as a pass.

## Catalog counts

Machine count from `python scripts/check-v02-sources.py`:

```json
{
  "total": 68,
  "enabled": 57,
  "aiConditional": ["fed-press_all", "fed-press_monetary", "nhc-atlantic"],
  "mediaConditional": ["esa-space-engineering", "mit-news-ai", "nasa-technology"],
  "errors": []
}
```

Additional catalog summary from `docs/focus-source-audit.md`: 11 disabled candidates, 36 excerpt feeds, 32 metadata-only feeds, 68 free-keyless feed adapters. The reviewed catalog is useful but below the planning breadth target of 80-120 because sources were not padded without reviewed terms.

## Task matrix

| Task | Status | Evidence |
|---|---|---|
| 1. Acceptance contract and source-cost rules | Implemented | `specs/002-focused-news/spec.md`, `specs/002-focused-news/tasks.md`, `docs/source-policy.md`, this report |
| 2. Section classification and compatible tab fields | Implemented | `src-tauri/src/topics.rs`, `src/types.ts`, `src/App.tsx`, `src-tauri/tests/focus_topics.rs` |
| 3. Cached classification migration | Implemented | `src-tauri/tests/focus_migration.rs` verifies a true legacy row, preserved id/firstSeen/published/updated/history/read/saved/hidden, idempotent reopen, v1 import and future-version rejection |
| 4. Four-group navigation and briefing | Implemented | AI/Technology/Stocks/Others navigation and default AI workspace; `src-tauri/src/briefing.rs`, `src-tauri/tests/briefing.rs`, `tests/e2e/focus-navigation.spec.ts` |
| 5. Central limits and zero-paid mode | Implemented | `MAX_SOURCES = 300`; `migrate_catalog(true)` bounded; non-Ollama providers rejected server-side; `src-tauri/tests/free_mode.rs` |
| 6. Feed bundles | Implemented with shortfall | 68 reviewed endpoints, not 80-120; `resources/sources.json`, `docs/focus-source-audit.md`, `tests/test_source_catalog.py` |
| 7. Source directory/health filters | Implemented | Settings/source health surfaces access mode, adapter and media review metadata; covered by e2e source/settings tests |
| 8. Item-scoped media authority | Implemented | NASA hash-pinned media preserved; MIT/ESA exact URL/item/byte/MIME/credit no-hash policies added; `src-tauri/src/rights.rs`, `src-tauri/src/media.rs`, rights/media tests |
| 9. Thumbnail loading/cancellation | Implemented | Host-mediated `media_load`, exact policy checks, cancellation/revocation tests. MIT/ESA lack SHA-256 due no network access for raw hashing; loader verifies byte count, MIME and magic bytes. |
| 10. Visual rows and consent controls | Implemented | Row image buttons and reader media controls covered by `tests/e2e/v02-media.spec.ts` and full Playwright run |
| 11. OpenRouter discovery | Implemented | `src-tauri/src/models.rs`, `src/ModelCatalog.tsx`, `src-tauri/tests/model_catalog.rs`, `tests/e2e/model-catalog.spec.ts` |
| 12. Benchmarks | Implemented | `src-tauri/src/benchmarks.rs`, `src/BenchmarkTable.tsx`, `src-tauri/tests/benchmarks.rs`, `tests/e2e/benchmarks.spec.ts`; Arena and SWE-bench remain separate panels/licenses |
| 13. Social coverage | Partially implemented by design | Mastodon/Lemmy/YouTube official metadata-feed paths retained. Reddit/X/Bluesky stay external-link-only; Bluesky synced ingestion is not implemented because moderation/delete/tombstone/rate-limit controls were not delivered. |
| 14. Fairness, deduplication and scale | Implemented | Existing diversity, grouping, hidden overflow, source cap and export-capacity tests preserved; full Rust/e2e suites passed |
| 15. Migrations, regressions, native acceptance and handoff | Mostly implemented; native CDP blocked | Regression/build suites pass. Native setup bugs were fixed and tested, but WebView2 CDP smoke cannot attach on this host; see native blocker below. |

## Verification commands

Passed:

- `npm.cmd run typecheck`
- `npm.cmd test` -> 4 files, 15 tests passed
- `npm.cmd run test:e2e -- --workers=1 --reporter=list` -> 163 passed
- `npm.cmd run build`
- `cargo fmt --manifest-path src-tauri\Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri\Cargo.toml` -> 128 lib tests passed, 7 ignored; all integration suites passed
- `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings`
- `python tests/test_source_catalog.py` -> 8 passed
- `python scripts/check-v02-sources.py` -> 68 total, 57 enabled, no errors
- `python scripts/package-release.test.py` -> 6 passed
- `python scripts/verify-installer.test.py` -> 3 passed, 1 skipped
- `python scripts/license-notices.py`, then `python scripts/license-notices.test.py` -> 5 passed
- `npm.cmd run tauri -- build --bundles nsis`

Environment-blocked or failed:

- `npm.cmd audit` and `npm.cmd audit --cache C:\tmp\news-terminal-npm-cache --audit-level=low` failed because the registry audit endpoint was unreachable in this restricted environment. No vulnerability result was obtained.
- `node scripts/native-smoke.mjs` failed to open a WebView2 CDP endpoint. Evidence: `docs/evidence/native-smoke.json`.
- `node scripts/focus-native-smoke.mjs --prefix focus-native-smoke-20260925-2350` failed before checks. Evidence: `docs/evidence/focus-native-smoke-20260925-2350.json`.
- `node scripts/focus-native-smoke.mjs --exe src-tauri/target/debug/news-terminal.exe --prefix focus-native-smoke-debug-20260925-2358` also failed to open CDP. Evidence: `docs/evidence/focus-native-smoke-debug-20260925-2358.json`.

Native fixes made during attempted smoke:

- First-run native setup now tolerates missing `current_monitor()` and even no monitor enumeration by using a sane `(0,0,1440,900)` fallback. Covered by `native::tests::initial_main_rect_*`.
- Main window creation moved into setup so smoke launches can opt into `NEWS_TERMINAL_CDP_PORT` and `NEWS_TERMINAL_WEBVIEW_DATA_DIR` without opening a production debug port.
- Native smoke scripts were updated to use those explicit app env vars and temp WebView data directories.

Fresh build artifacts:

- `src-tauri/target/release/news-terminal.exe`
- `src-tauri/target/release/bundle/nsis/News Terminal_0.4.0_x64-setup.exe`

## Security and licensing tradeoffs

- MIT and ESA media approvals are item-scoped and exact-asset-gated, but are not hash-pinned because raw downloads were unavailable in this environment. They require exact URL, item URL/GUID, byte count, MIME, magic-byte validation and credit. NASA remains hash-pinned.
- No paid scraping proxy, paid news API, hosted inference or third-party hosted model run was added.
- Old cloud provider settings remain import-compatible but cannot execute in zero-paid mode.
- Reddit, X and Bluesky are intentionally not automatic feeds. External links are not data-ingestion permission.
- Native CDP smoke is the largest remaining release gate. The app startup panic found by smoke was fixed, but this host still does not expose a WebView2 CDP endpoint for Playwright evidence.
