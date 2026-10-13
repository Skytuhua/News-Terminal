# Development and verification

News Terminal is a Windows desktop application. Rust owns networking,
SQLite/FTS5, source scheduling, AI/credentials, notifications and native
windows. React renders typed IPC snapshots and submits explicit intents.
Workspace revision checks reject stale concurrent writes. See the
[IPC contract](IPC-CONTRACT.md).

## Set up

Use Node.js 24/npm, stable Rust with the MSVC toolchain, Visual Studio C++
build tools/Windows SDK, and installed WebView2. Python 3.11+ is needed for the
catalog and license-notice checks below. See the
[Windows quick start](../README.md#start-on-windows).

From the repository root:

```sh
npm ci
npm run tauri -- dev
```

The browser development server alone cannot provide the native runtime.
Browser E2E uses explicitly labeled fixtures and a test-only Vite mode;
fixture news and IPC injection are excluded from the production bundle.

## Checks

The Windows CI workflow runs TypeScript, unit/browser tests, Rust formatting,
Rust tests, Clippy with warnings as errors, and an unsigned installer build.
Browser failures produce GitHub annotations and a test-results artifact.

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Catalog and notice checks:

```sh
python tests/test_source_catalog.py
python scripts/check-v02-sources.py
python scripts/license-notices.test.py
python scripts/license-notices.py --check --strict-windows
```

Use `npm audit` when reviewing dependencies. Investigate dependency changes
individually and preserve the checked-in lockfiles.

## Build and native verification

```sh
npm run tauri -- build --bundles nsis
node scripts/native-smoke.mjs
node scripts/focus-native-smoke.mjs --exe src-tauri/target/release/news-terminal.exe
```

The standalone executable is `src-tauri/target/release/news-terminal.exe`.
The NSIS installer is under `src-tauri/target/release/bundle/nsis/`.
Builds are unsigned. WebView2 must already be installed; the package does
not bundle or automatically install Microsoft runtimes.

The native smoke runner launches the actual executable with fresh temporary
data, fetches live feeds, exercises IPC/UI/native detachment/restart recovery,
and records evidence under `docs/evidence/`. It enables a WebView2 debug
endpoint for its child process, then terminates that process tree. Keep that
endpoint local. It does not change normal app data.

For the current daily and sector runners, required evidence and executable
hashes, follow [native acceptance](v05-native-acceptance.md). Historical captures
record the revision tested at the time; a build or fixture test alone does
not establish native release acceptance. The [PR review notes](pr-stack-review.md)
record the combined stack's fixes and local validation.

## Optional service fixtures

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --test-threads=1 --nocapture
```

These contact a public USGS feed, temporarily write/delete a unique non-secret
Windows Credential Manager fixture, and bind a fixture Ollama endpoint on
port 11434. Stop a real Ollama instance before running that fixture. These
tests do not establish live cloud inference or use of a downloaded model.

Zero-paid mode retains imported provider settings but blocks cloud summary
execution in Rust. Local Ollama still needs an installed model, explicit
consent and source permission. Credentials are stored in Windows Credential
Manager and excluded from backups.

## Data and bounded defaults

The default data folder is the Tauri app-data directory for
`com.newsterminal.desktop` under the current Windows user's roaming app data.
For isolated testing or a chosen data location, set `NEWS_TERMINAL_DATA_DIR`
before launch. This does not relocate the Windows credential store.

JSON backups contain preferences and reading history and should be kept
private. Import validates before replacing data and requires confirmation;
AI consent is disabled on import. Native window placement is a separate
local file, outside the JSON backup.

Defaults are bounded to 32 profiles, 300 sources, 100 watchlists per profile,
50 tabs per profile, 32 detached windows, 5,000 recent cached articles and
up to 10,000 saved stories. Unsaved retention is 30 days; revisions retain
the latest 20 stored versions. Refresh intervals and backoff also apply to
manual refresh. Related coverage is a conservative heuristic; source
diversity is a distribution control.

## Scope and contribution

Keep changes focused and include reproduction steps or appropriate evidence
for behavior changes. Preserve original source links and attribution; reading
permission does not grant AI-processing or redistribution permission.

- [Original acceptance contract](../specs/001-news-terminal/spec.md)
- [Focused news contract](../specs/002-focused-news/spec.md)
- [Source policy](source-policy.md)
- [Privacy and data handling](privacy.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [MIT license](../LICENSE)
