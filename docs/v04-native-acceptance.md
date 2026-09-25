# v0.4 isolated Windows/WebView2 acceptance

## Accepted result

**12 checks passed, 0 failed** in [`evidence/v04-native-debug-accepted.json`](evidence/v04-native-debug-accepted.json). This runs the real Windows executable, its embedded production frontend, Tauri dispatch and SQLite. It is not the Playwright browser fixture.

- Executable: `C:/Users/user/Documents/News Terminal/src-tauri/target/debug/news-terminal.exe`
- SHA-256: `00accabeca07916aed7b1caa53b1aaf80a4b325a74661ed64b7a88ab6bde95e3`
- Build: debug/custom protocol, existing **0.3.0 version unchanged**, with current v0.4 implementation. This is not a packaged-release acceptance claim.
- Actual launched byte-identical copy, reused for all three launches: `C:/Users/user/AppData/Local/Temp/news-terminal-v04-native-TBgD93/v04-native-app.exe`
- Isolated `NEWS_TERMINAL_DATA_DIR`: that same temporary directory; WebView2 data is its `webview` subdirectory. No personal application data was opened or imported.
- Owned application PIDs: 9004, 18216, 18176. All closed via native WM_CLOSE, exit code 0, no forced termination. A subsequent Win32 process inventory returned **0** matching test applications/WebView2 children.
- Actual WebView2 user agent reported Edge/Chrome 153.0.0.0. Main document was `http://tauri.localhost/`, not port 1420.
- Eleven screenshots captured; page errors and console errors both empty.

Build output: [`v04-native-debug-build.log`](evidence/v04-native-debug-build.log). Accepted execution: [`v04-native-debug-accepted-run.log`](evidence/v04-native-debug-accepted-run.log).

## Reproduce / exact packaged-executable handoff

From the repository root in Git Bash:

```sh
npm run build
TAURI_CONFIG='{"build":{"devUrl":null}}' cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
node --check scripts/v04-native-smoke.mjs
node scripts/v04-native-smoke.mjs --prefix v04-native-debug-repeat
```

For an already-built packaged executable, **do not rebuild it inside the harness**:

```sh
node scripts/v04-native-smoke.mjs --exe 'C:/path/to/extracted/news-terminal.exe' --prefix v04-native-packaged
```

`--prefix` must start with `v04-native-`; choose a fresh prefix to retain previous evidence. The script verifies embedded JS and CSS bytes against the repository's current `dist` files. Build `dist` from the exact source intended for the package before running. A stale/mismatched asset fails acceptance rather than silently testing a previous frontend. The accepted assets were:

| Asset | SHA-256 |
|---|---|
| `index-Bqe_x5f4.js` | `27afa0b40d60685fc9a0c5e1692670ba6d70b4c24e642bb0ea328662a85b37cc` |
| `index-j-nLpYet.css` | `0c9cdbffdd472874b940d84a2d859c82d9bc37f4d6c33a0babc37a4f99508971` |

Requires Windows, installed WebView2, the repository's existing `@playwright/test`, and Python with standard-library ctypes (`DAILY_NATIVE_PYTHON` can override the executable, inherited from the daily harness). Each launch uses a fresh loopback CDP port. No Vite server, source mock, package installation, system configuration change or release-version edit is involved.

## What the 12 checks establish

1. **Real runtime and freshness:** Win32-owned main window, embedded `tauri.localhost` document, exact executable hash, and current JS/CSS byte equality.
2. **Validated synthetic fixture:** native backup import creates 5,201 clearly labeled synthetic stories and two profiles. There are 201 pre-hidden default-profile stories outside the ordinary 5,000-row snapshot; another profile saves those stories to preserve them under existing retention without changing default-profile state. The oldest fixture is French while default preferences permit English. Providers remain disabled.
3. **Read endpoint parity/purity:** `workspace_get` equals `snapshot.workspace`; both new endpoints accept explicit profiles; complete exported data is unchanged and no `data-changed` event is observed during these reads.
4. **Real Save → Hide → dismiss Undo:** UI actions persist `saved:true`, `read:true`, `hidden:true`; the Undo notice is deliberately dismissed.
5. **First exact-binary restart:** Hidden navigation recovers the story without Undo. Hidden mode is persisted. Observed UI dispatch order begins `workspace_get`, `workspace_save`, then authoritative snapshot reads.
6. **Complete recovery traversal:** native pagination enumerates 202 unique hidden stories with at most 100 rows mounted. Title/publisher search finds the French, oldest retained story omitted from the ordinary snapshot. Search, paging and Ctrl+K preserve all state records and issue no article-state, FTS search, media, AI or refresh operation.
7. **Profile isolation:** the UI-selected second profile has an empty Hidden collection, while default retains 202; switching back restores its collection. The final export independently verifies all 201 other-profile states remain saved, unread and not hidden.
8. **Recovery layout:** actual WebView2 content is captured at narrow 800×650 CSS and 200%-equivalent 720×450 CSS. No horizontal body overflow; first story and Restore remain reachable, with a 99% row-intersection threshold to allow subpixel/border rounding.
9. **Source-health inspection:** one enabled synthetic failure contributes to the failing count; a disabled synthetic failure does not. The real host data renders failed/no-success, raw status, last attempt and future eligibility. Desktop/narrow/short dialog captures retain the close control. Inspection sends no source-update, refresh, media, AI or article-state operation, and the full source collection is unchanged.
10. **Restore mutation:** the UI sends exactly `{op:'article_state', profileId:'default', articleId:'v04-synthetic-0000', hidden:false}`. Confirmed readback removes the story from Hidden while preserving Read, Saved and group identity; other-profile Hidden remains empty.
11. **Second exact-binary restart:** restored state and Hidden mode survive. Saved stories contains the restored item; 201 other hidden stories remain recoverable.
12. **Final integrity/errors:** all 5,201 articles remain explicitly synthetic; other-profile flags remain intact; providers stay disabled; exactly the intended synthetic source remains enabled; no page, console or IPC-observation error.

The CDP debugger observes calls at the real `__TAURI_INTERNALS__.invoke` function and resumes them without replacing arguments, return values or implementation. It includes a positive-control read so an empty/broken observer cannot pass a negative-call assertion. Debugger overhead means this is **not a performance benchmark**.

## Screenshot review and precise scaling boundary

Reviewed accepted-run captures:

- [Hidden narrow](evidence/v04-native-debug-accepted-hidden-narrow.png)
- [Hidden 200%-equivalent](evidence/v04-native-debug-accepted-hidden-200pct.png)
- [Sources narrow](evidence/v04-native-debug-accepted-sources-narrow.png)
- [Sources 200%-equivalent](evidence/v04-native-debug-accepted-sources-200pct.png)

Titles, Saved/Read state and Restore are readable together. At short height, the recovery pane is intentionally scrolled past its explanatory header to expose complete stories; the header is reachable by scrolling up. The source-health dialog retains its heading/close button while its content scrolls; long eligibility and permissions text wraps. Compact desktop controls remain compact, not touch-first controls.

Additional captures include desktop Hidden and Sources, out-of-snapshot recovery, other-profile empty state, confirmed restore, and restarted Saved membership; all paths are in the JSON.

**These are real WebView2-rendered client screenshots with CDP CSS-viewport emulation.** 720×450 is the layout equivalent of a 1440×900 viewport at 200%. Observed native `devicePixelRatio` stayed **1.5**, which is recorded rather than relabeled as 2. Neither a physical Windows DPI change, actual browser ZoomFactor=2, native outer-window resizing, nor OS chrome capture is claimed. Actual 200% browser/physical-DPI acceptance remains a separate manual gate if required.

## Isolation, source facts and limits

Startup may refresh default sources before the harness can disable them. That native refresh is drained before importing the fixture. Thereafter only one synthetic `example.invalid` source is enabled, with future retry eligibility; all providers are disabled. Its HTTP 429 status is explicitly **imported synthetic host data**, not evidence of a live HTTP 429 response. No OS-wide packet capture or zero-network claim is made.

Hidden recovery still depends on retained articles. The fixture's other-profile saves exercise existing retention protection; hidden alone is not represented as protecting articles forever. The older fixture is outside the retrieval cap, not an artificially promised recovery of deleted/expired content.

This pass does not cover NSIS/install/uninstall, packaged-executable identity, live feed quality, source permission grants, physical monitor/DPI transitions, native deliberate read/write failures, or every browser-fixture race. The parent must rerun the same script against the exact packaged executable before release-native acceptance.

## Harness/build issues retained honestly

Earlier evidence is retained, not reported as passing application tests:

- `v04-native-debug-attempt1.json`: a debug build with `tauri/custom-protocol` alone still attempted the configured dev URL. The command-local `TAURI_CONFIG` override above fixes the build without changing repository configuration. The nonexistent top-level `custom-protocol` feature was also rejected before the corrected dependency-feature build.
- `v04-native-debug-attempt2.json`: validated import correctly rejected a synthetic second profile without its required workspace. The harness fixture now includes that workspace.
- `v04-native-debug-attempt3.json`: a 100% row-intersection assertion encountered 0.998998 border/subpixel intersection; a subsequent narrow-layout state caused a source-nav timeout. An attempted JS assignment could not instrument Tauri's protected invoke function; the required positive Restore trace failed instead of silently passing. The harness now uses read-only CDP function breakpoints and subpixel-tolerant row visibility.
- `v04-native-debug-attempt4.json`: 12/12 passed, but follow-up metrics review showed requested DPR overrides were not taking effect. Its earlier `@2x` method text must not be used as a scaling claim.
- `v04-native-debug-final.json`: an explicit DPR=2/1 assertion failed on this WebView2 (DPR remained 1.5), causing a dependent source-nav failure. Final acceptance uses verified CSS dimensions and truthfully records native DPR; it is **`v04-native-debug-accepted.json`**, not the misleadingly named earlier `-final` run.

Only `scripts/v04-native-smoke.mjs`, this document and `docs/evidence/v04-native-*` were authored by this task. Frontend/native build outputs were regenerated as requested; no application source, dependency, package/release version, prior 0.3 distribution, installation, commit or production data was changed.
