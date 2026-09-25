# Native acceptance harness lifecycle repair

## Outcome and scope

The current release executable passed **12/12 twice** using the repaired `scripts/v04-native-smoke.mjs`. No application source, package/version files, executable, or installer were changed. All twelve functional check bodies and assertions are preserved byte-for-byte after accounting for the single added pre-reload `await stopTrace()` statement. The existing `assert.equal(evidence.traceError, undefined)` is retained.

- Executable: `C:/Users/user/Documents/News Terminal/src-tauri/target/release/news-terminal.exe`
- Executable SHA-256: `514f75283af424a77138aedc98717325028d38876402e0665e63e84fc5517158`
- Final harness SHA-256: `e998e6dc754b279566de093837fdc01e03e82827c92068e29dac6e922c34c740`
- Acceptance: [first run](evidence/v04-native-fixed.json), [repeat](evidence/v04-native-fixed-retry.json); console logs have matching `-run.log` names.
- Programmatic comparison/verification: [v04-native-fixed-verification.json](evidence/v04-native-fixed-verification.json).

## Root cause and evidence

The original `trace()` installed an async `Debugger.paused` EventEmitter listener. That callback awaited `Debugger.evaluateOnCallFrame` and then `Debugger.resume`, but no owner tracked or awaited its promise. `stop()` posted native WM_CLOSE before retiring the collector. The old session was detached only when the next `trace()` ran, after the previous target had already closed. It also referenced mutable global `traceSession`, making late callbacks capable of addressing a later session; resume failures were silently ignored.

Candidate explanations were (1) pending collector work overlapping intended close, (2) an application crash/frontend exception, or (3) stale executable/assets. The retained `v04-native-release.json` and `v04-native-release-retry.json` both show 11/12, only the final trace-error assertion failing, no page/console errors, all three native exits zero, no force kills, and the same executable hash verified above. Their embedded-asset freshness check passed. This points to collector ownership, not application failure.

The race is timing-dependent: the fresh unchanged baseline named `v04-native-fixed-red.json` actually passed 12/12; its name does **not** mean it was red. A passive instrumented original also passed (`v04-native-fixed-probe.json`). Neither is presented as a failing reproduction.

For deterministic native proof, [v04-native-fixed-race-probe.mjs](evidence/v04-native-fixed-race-probe.mjs) runs the original lifecycle with a clearly labeled diagnostic scheduling barrier: it starts a real `workspace_get` request, holds the paused collector continuation, performs the original intended graceful close, then releases that continuation. This delays harness collection only; IPC responses and application code are not mocked. It is a diagnostic, not the acceptance harness.

The [native race evidence](evidence/v04-native-fixed-race-probe.json) reproduced the exact result **11/12** and error `cdpSession.send: Target page, context or browser has been closed`:

- First restart PID 21380: WM_CLOSE at `2026-09-24T09:27:52.130Z` with one pending collector; evaluation and resume both failed at `09:27:52.373Z` during `intended-graceful-WM_CLOSE`.
- Second restart PID 34128 and final shutdown PID 15844 repeated the same pending-close error.
- All three native processes still exited zero; none required force-kill.

The barrier establishes the ordering defect; it does not claim every ordinary launch will hit it. The unmodified original is retained at `evidence/v04-native-fixed-original.mjs` for source comparison/seam testing (not direct native execution from that relocated path).

## Repair

1. Bind each paused listener to its own immutable session and observation buffer.
2. Track the whole evaluation **and resume** promise in a collector-owned pending set.
3. Before WM_CLOSE and before reload, acknowledge `Debugger.setSkipAllPauses`, drain pending listeners, disable debugging, drain again, remove the listener, and detach while the target remains alive.
4. Only after successful retirement issue native WM_CLOSE. Retirement errors remain recorded failures, while physical cleanup still runs to avoid orphaning the owned process.
5. Preserve evaluation errors and now record resume/retirement errors too. Keep the original trace-error assertion; additionally gate final `evidence.passed` on no trace error so failures during final cleanup cannot escape an already completed check.
6. Record collector pause/completion counts, pending counts, detach timestamps, and native-close timestamps.

No timeout-based ignore, error-string filtering, removal of assertions, fake acceptance results, or application changes are used.

## Deterministic regression and native verification

The seam test evaluates the harness's actual `trace`, `stopTrace`, `calls`, and `stop` functions with an explicit controllable CDP transport. It tests pending evaluation, pending resume, preservation of live evaluation/resume failures, and failure propagation after the last functional check. It is unit coverage, not native UI evidence.

Initial test-first execution failed the lifecycle and swallowed-resume cases before implementation. The final expanded suite has **1/5 passing against the retained original and 5/5 against the fix**; see [red log](evidence/v04-native-fixed-lifecycle-red.log) and [green log](evidence/v04-native-fixed-lifecycle-green.log).

Run from the repository root (Git Bash):

```bash
# Expected failure against original collector (exit 1).
V04_HARNESS_SOURCE=docs/evidence/v04-native-fixed-original.mjs node --test docs/evidence/v04-native-fixed-lifecycle.test.mjs
# Expected 5/5 against the current harness (exit 0).
node --test docs/evidence/v04-native-fixed-lifecycle.test.mjs
node --check scripts/v04-native-smoke.mjs
# Diagnostic scheduled native reproduction of the old bug (exit 1).
node docs/evidence/v04-native-fixed-race-probe.mjs --exe 'C:/Users/user/Documents/News Terminal/src-tauri/target/release/news-terminal.exe' --prefix v04-native-fixed-race-probe
# Actual unchanged release executable; current production harness (both exit 0).
node scripts/v04-native-smoke.mjs --exe 'C:/Users/user/Documents/News Terminal/src-tauri/target/release/news-terminal.exe' --prefix v04-native-fixed
node scripts/v04-native-smoke.mjs --exe 'C:/Users/user/Documents/News Terminal/src-tauri/target/release/news-terminal.exe' --prefix v04-native-fixed-retry
```

The two fixed native runs verify 6 launches and 8 retired collectors, with 295 completed pause handlers, zero pending work after every drain, no trace/page/console/fatal/cleanup errors, zero native exit codes, and no force kills. Each collector detached before its native close request. These ordinary runs happened to have zero handlers pending at stop entry; the explicit barriers supply coverage of the nonzero-pending case. Actual native screenshots are retained under both acceptance prefixes.

| # | Unchanged functional check | First | Repeat |
|---|---|---|---|
| 1 | actual Windows WebView2 and embedded asset freshness | PASS | PASS |
| 2 | isolated validated 5201-story fixture and profile-specific retained state | PASS | PASS |
| 3 | workspace_get parity and both new reads leave export unchanged with no data-changed events | PASS | PASS |
| 4 | UI saves and hides story then dismisses Undo with host confirmation | PASS | PASS |
| 5 | exact-executable restart retains hide and persistent Hidden navigation | PASS | PASS |
| 6 | 202 hidden rows reached beyond snapshot cap and preferences with no read/media/AI writes | PASS | PASS |
| 7 | profile switch isolates hidden collection | PASS | PASS |
| 8 | actual WebView2 narrow and 200-percent-equivalent hidden layouts | PASS | PASS |
| 9 | source health host facts and read-only inspection | PASS | PASS |
| 10 | Restore writes only hidden:false and preserves saved/read/group | PASS | PASS |
| 11 | second exact-executable restart retains Hidden mode and restored Saved membership | PASS | PASS |
| 12 | final fixture isolation and frontend errors | PASS | PASS |

## Boundaries and handoff

This verifies the exact standalone release executable and its current embedded assets, not installer acceptance, real news/network quality, or physical display/DPI behavior. The parent owns final installer re-verification because the harness fingerprint changed. No native process remains owned by this task after the recorded clean terminations. The global graph index was absent; the repository `graphify-out/GRAPH_REPORT.md` was read instead.
