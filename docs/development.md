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

### Independent browser harnesses

`npm run test:e2e:list` lists available browser checks without launching a server
or browser. `npm run test:e2e -- tests/e2e/reader.spec.ts` runs a focused journey.
The runner resolves the checkout from its own location, so an absolute invocation
also works from another folder, including paths containing spaces.

Browser journeys depend on a separately reported `startup` project. It loads the
unmocked browser screen once with a 60-second startup test budget, so Vite's first
application transforms finish before ordinary tests spend their 30-second
budget. Startup uses the configured browser and base URL, records page and local
asset failures, and blocks journeys if the application does not load. Failure
artifacts include a trace and `browser-startup.json`. Browser launch and teardown
have their own Playwright limits.

Filename and grep filters, including `--project=chromium`, retain this dependency.
Listing, help and a selection with no matching tests do not launch a browser.
Playwright's explicit `--no-deps` option skips startup; use it only when that
bypass is intended. Direct Playwright invocations use the same project setup.

For a separate worktree or concurrent run, choose an unused local port in
PowerShell:

```powershell
$env:NEWS_TERMINAL_E2E_PORT = '1432'
$env:NEWS_TERMINAL_E2E_OUTPUT_DIR = 'test-results/reader-check'
npm run test:e2e -- tests/e2e/reader.spec.ts
```

The wrappers and direct Playwright configuration use the same validated port.
An occupied port fails; the harness does not attach to an existing server or
stop its owner. Vite dependency caches are separate for each checkout and port.
Artifacts use the selected output directory. It must be `test-results` or a
folder beneath it because Playwright clears test output before a run. The
path must contain no symbolic links or junctions. The default HTML report remains
`playwright-report`; a custom output directory gets a sibling
directory with `-report` appended. Relative paths resolve within the checkout.
An optional `NEWS_TERMINAL_BROWSER_EXECUTABLE` selects an installed Chromium
executable. The default remains Playwright's installed Chromium. A system browser
run establishes behavior for that browser version only.

Set `NEWS_TERMINAL_E2E_SERVER=external` only when invoking Playwright directly
against a fixture server you already own on the selected port. The npm wrapper
starts and closes its own fixture server and returns the test process exit code.
CI runs branch changes through pull requests and runs the merged main revision
once, avoiding duplicate push and PR jobs for each feature branch.

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
npm run test:native:daily
npm run test:native:features
```

The standalone executable is `src-tauri/target/release/news-terminal.exe`.
The NSIS installer is under `src-tauri/target/release/bundle/nsis/`.
Builds are unsigned. NSIS installers newly built from this source bundle
Microsoft's offline WebView2 installer and install the runtime when it is
missing, using a current-user setup. The standalone executable and portable ZIP
still require an existing WebView2 Runtime. Building the bundled prerequisite
needs access to Microsoft's Evergreen download. This configuration change does
not publish a new release. Follow [installer payload verification](installer-payload.md#current-release-owner-sequence)
for the build, extraction and packaged-application release gates.

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

The current SQLite schema is version 2. Its one-time search-index migration
preserves articles, reading state and history, and creates a coherent SQLite
snapshot before upgrading an existing version-1 database. For the default
database the snapshot is `news-terminal.v1.pre-migration.sqlite3` beside the
database; existing snapshots are not overwritten. Version-0 migrations retain
the legacy `*.pre-migration.sqlite3` name. Current-schema opens do not repeat
the migration or backup. Older binaries reject a version-2 database; the JSON
backup format remains version 1.

JSON backups contain preferences and reading history and should be kept
private. Import validates before replacing data and requires confirmation;
AI consent is disabled on import. Native window placement is a separate
local file, outside the JSON backup.

Native file backups stream the existing version-1 JSON format directly between
disk and the database. Imports accept any top-level key order and stage records
in a temporary local SQLite file before validation and one replacement
transaction. No aggregate file-size, article-count or state-count limit is
imposed: a refresh may be interrupted before cache retention. SQLite checks
article identities and state references through its indexes, without retaining
all article IDs in memory. The bounds are 5,000 documents, 1,244,256
alert receipts (32 profiles, three deliveries per ten minutes, 90 days including
both endpoints), and 32 MiB per JSON record. The legacy string IPC operations
keep their 32 MiB limit. Native file contents do not cross the renderer IPC.
Both paths share record validation and reject duplicate keys, unknown fields,
invalid references and trailing data; import never restores AI/media authority
or credentials. Excerpt history is retained subject to source storage policy.
The backup validator accepts up to 15,000 distinct saved IDs from legacy files.
New UI saves keep the existing 10,000 unique-story cap; larger imports cannot repeatedly
increase the legacy saved allowance.

A persistent sibling `.lock` file holds an operating-system exclusive lock for
each open database host. A second host fails before opening SQLite; the lock is
released when the owning database closes. In-memory fixtures remain independent.

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
