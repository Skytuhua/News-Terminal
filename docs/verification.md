# News Terminal verification

## Current verified state

The actual Windows Tauri application builds and runs with real publisher feeds. The latest reproducible application gate is `python scripts/verify-release.py`; its exact command list, exit codes and timestamps are in [evidence/release-checks.json](evidence/release-checks.json), with one full log per command. All eleven application checks passed in the parent run. The final installer-specific payload gate also passed: all 383 dependency-notice files and 11 installer-notice files match packaged bytes. Both installer layers and plugin sets were inspected, and the extracted packaged application passed a separate native smoke run. See `installer-payload.md` and `evidence/installer-payload.json`.

## Test evidence

| Gate | Parent-verified result |
|---|---|
| Rust suite | 54 passed, 3 opt-in tests ignored by default; zero failures |
| Opt-in service checks | All 3 passed separately: actual USGS feed, Windows credential fixture roundtrip/removal, localhost Ollama HTTP **fixture**, not a live model |
| TypeScript | Typecheck passed |
| Frontend units | 6 passed |
| Browser E2E | 36 passed; test-only fixtures, not claims of native execution |
| Rust format + all-target Clippy | Passed; Clippy uses `-D warnings` |
| npm audit | 0 vulnerabilities reported for the locked npm graph; not a universal security guarantee |
| Dependency notice regression suite | 5 passed |
| Windows dependency notice freshness | `--check --strict-windows` passed; zero Windows/npm notice gaps |
| Windows release | Actual application `.exe` and NSIS installer build succeeded |
| Native smoke | Passed, with 27 recorded checks/measurement entries; see [native-smoke.json](evidence/native-smoke.json) |

## Requirement-to-evidence matrix

| Requirement | Evidence |
|---|---|
| Real RSS/Atom, bounded HTTPS, safe links/excerpts, failure isolation | `src-tauri/tests/services/unit.rs`, library tests, actual native live-feed refresh and source failure |
| Offline saves and restart | `src-tauri/tests/backend.rs`, native saved/read isolation, failed-source cache and restart checks |
| Profiles, preferences, deterministic reasons/diversity, FTS | Backend ranking/state tests; frontend settings/reader tests; native FTS and actual UI profile switch followed by process restart |
| Many tabs and native multi-monitor workspace | 50 persisted tabs; actual detach/reattach; real 100%/150% displays including negative x; missing-monitor recovery; orphan-import/restart regression |
| Related coverage, splitting, correction timeline, catch-up | Backend grouping, corrected-date and stable-visit tests; `tests/e2e/coverage.spec.ts` and reader regressions |
| Watchlists, quiet hours, alerts | `backend_alerts.rs`, watchlist E2E; native all-day quiet suppression, one accepted Windows notification API receipt and dedup readback |
| Optional AI and consent | Host/service tests for disabled and metadata-only sources, fallback/cancellation, consent revocation and secret-free errors; summary E2E |
| Concurrent workspace/import correctness | Mandatory revision tests, safe revision bounds, delayed-tab query test, import/refresh exclusion test, truthful import readback and orphan reconciliation |
| Restorable backup/migration/retention | `backend_limits.rs` boundary tests, atomic invalid import, migration backup and saved-story retention tests |
| Readable keyboard UI | 1440/1024/720/480 fixture screenshots, reader/shortcut/focus tests, inspected real native reader/detached/monitor screenshots, simulated 200% and reduced-motion reflow |
| Source policies and credits | `sources.md`, `source-policy.md`, `references.md`, `THIRD_PARTY_NOTICES.md`, versioned dependency licenses and MPL source archives |

## Review findings resolved

Independent review identified, and regressions now cover: mid-summary consent revocation, export/import limit mismatch, in-flight refresh/import source attribution, optional/unsafe workspace revisions, failed notification receipts, corrected publication dates, stale profile UI after import, delayed tab-query ownership, main-profile restoration, orphan native windows, search-buffer bypass, modal background shortcuts and settings focus restoration. Native inspection also found and fixed an empty-reader first-load staging defect.

## Measurements and qualification

`native-smoke.json` records fresh launch-to-reader timings, twenty cached FTS roundtrips, process-tree working sets with fifty tabs, and a short idle CPU/private-memory sample. Do not conflate summed working sets with private memory: WebView2 shares pages and uses GPU/helper processes. This is a small real cache on one Windows machine with a local debugging connection, not a universal performance claim. Baseline targets for this machine are sub-two-second reader readiness and under-50-ms cached FTS; treat them as regression investigation thresholds rather than hard guarantees across devices.

The idle socket inventory observed external HTTPS connections in the WebView2 process tree even with configured feeds disabled. No packet payloads were captured or attributed. Privacy docs distinguish application analytics from platform-runtime behavior. Local/network IP addresses are omitted from committed evidence.

## Explicit limitations

- Local unsigned x64 build; no Authenticode signing or GitHub publication. WebView2 must already be installed; this package does not install a Microsoft runtime.
- The reviewed catalog is 27 sources (16 enabled, 11 disabled), not exhaustive global coverage. English-only independent politics/sports/entertainment coverage is limited; CNA adds broader Traditional Chinese coverage under personal/noncommercial conditions. Reddit/X are links, not scraped streams.
- All bundled sources start `aiAllowed:false`. Live Gemini/Groq inference and a real installed Ollama model were not configured; only properly labeled adapters/fixtures and failure paths are verified. Free-tier billing eligibility remains the user's provider-account responsibility.
- Notification API acceptance was observed; a visible Windows banner was not independently confirmed. Focus Assist/OS settings can suppress presentation. Alerts require the app to remain running.
- Offline checks preserve/read local data and disable configured feeds; browser offline emulation alone does not disable Rust or the platform runtime. This is not an air-gap test.
- 100%/150% hardware monitors were exercised; 200% was CDP simulation, not a physical Windows setting change.
- Profiles support create/switch/preferences/reset, not rename/delete controls. No hidden destructive controls are advertised.
- Thirty notice gaps are for other-target/optional Cargo packages outside the Windows dependency closure. All-target strict mode deliberately fails; it is not approval for distributing Linux/macOS/other feature builds.
- The GitHub Actions workflow is provided but has not been run remotely. Mission Control research capture was unavailable because the configured local rule file was missing; no destination or upload was invented.
