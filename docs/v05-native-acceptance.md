# 0.5 native acceptance and evidence limits

## Recorded Windows results

The committed Windows runs from 2026-09-30 record **13 of 13** daily checks in
[`daily-native-v05-final.json`](evidence/daily-native-v05-final.json) and
[`daily-native-v05-final2.json`](evidence/daily-native-v05-final2.json), including
the detached pane scope, restart, and reattach checks. The 0.5 feature runs in
[`v05-native-g2.json`](evidence/v05-native-g2.json) and
[`v05-native-g3.json`](evidence/v05-native-g3.json) record **10 of 10** checks
and graceful app exit code 0.

These historical runs use a native release executable, isolated temporary
appdata, synthetic fixtures imported through the validated backup API, and no
mocked IPC or DOM. They do not establish that the runners revised during review
pass on Windows: this review environment runs Linux and cannot execute the
Windows/WebView2 application.

The daily artifacts include executable and runner SHA-256 hashes. The existing
0.5 feature artifacts identify the embedded JavaScript and CSS, but contain no
executable or runner hash; they cannot identify the Rust binary that produced
their results. Future 0.5 feature runs now record both hashes and launch a
temporary executable copy whose hash is checked before launch. The historical
evidence files have been preserved unchanged.

Build the revision under review with `npx tauri build --no-bundle` and rerun both
native scripts on Windows before claiming current native acceptance. The Tauri
CLI runs the frontend build command; a plain `cargo build --release` does not
establish frontend freshness. Windows CI now builds and inspects the NSIS
payload, then runs the feature smoke against the inspected packaged executable.
The daily smoke still needs a separate Windows run. CI requires an existing
WebView2 Runtime. It does not run NSIS setup or the WebView2 installer.

## Resolved: the detached window was invisible to CDP

The detached-window check previously never reached a ready CDP target.
Instrumentation showed all three of:

- the host recorded the detached tab correctly (`detachedTabs` reported
  `tabId: home`);
- Win32 enumeration found the window, titled
  "News Terminal · Detached workspace";
- the CDP target list held exactly one page for the whole 20 second sample.

The main window received `--remote-debugging-port` from `NEWS_TERMINAL_CDP_PORT`
when it was built at startup, but a window created later, as a detached tab is,
was built without those browser arguments and so never registered an endpoint.
The port and isolated data directory are test-only affordances driven by an
environment variable, so this never affected a real user.

`src-tauri/src/native.rs` now applies the same debugger arguments and data
directory to windows created after startup, reusing the main window's
`cdp_browser_args` helper rather than duplicating the argument string.

Two assertions in the daily smoke were corrected once the check could finally
run, and both are recorded here because they had been unreachable since the
check was first written:

- the reattach check addressed its tab by a hardcoded title that does not
  exist after a restart; it now uses the first tab in the `Workspace tabs`
  tablist, the pattern the rest of the file already uses;
- the reattach check read the reading pane width in the same tick as the tab
  click, so the divider attribute had settled at 470 while the measured pane
  was still 430. The first polling implementation accepted any returned state
  object and therefore did not wait. The review correction returns a state
  only when its rendered reading pane width is 470; it otherwise polls until
  the existing timeout and preserves the width assertion.

Neither change weakened an assertion: the expected values are unchanged, only
the waiting and the addressing.

The 0.5 feature runner also now marks the run failed and returns exit status 1
when it records an uncaught frontend page error, even if every named check
passes. Console errors remain recorded for diagnosis.

## Historical shutdown evidence

Earlier runs recorded the app alive when the smoke's own `finally` block ran
`taskkill /F`, followed by app exit code 1. The two historical feature runs
linked above subsequently recorded graceful exit code 0 after switching to
`WM_CLOSE`. Those artifacts remain unchanged.

The 2026-10-18 PR 16 CI report exposed a separate acceptance error: all ten
feature checks passed, the harness recorded a force attempt with command
status 255, and the app's exit code 0 was observed later. The script still
returned success. Its discarded command output prevents diagnosing why
`taskkill` returned 255. A delayed exit event alone does not establish when the
OS process ended or which action ended it. Synchronous helper commands block
Node from observing events, and disconnecting CDP closes Playwright page
objects without proving that their native windows closed.

## Final cleanup is part of acceptance

Both runners now begin with a failing process exit status and compute their
overall result only after cleanup. Individual `PASS` lines describe completed
checks. The final JSON, final console summary, and process exit status must all
agree before accepting the run.

The shared `scripts/native-process-cleanup.mjs` helper keeps the existing
graceful deadlines: eight seconds for feature shutdown and ten seconds for
each daily shutdown. The Win32 helper uses pointer-sized argument types,
checks the owned main-window PID and `PostMessageW` result, and records its
window snapshot before posting. Window enumeration, force cleanup, and CI
firewall commands run asynchronously so Node can observe the app's exit while
they run. Their command deadlines remain bounded; CDP disconnect has a five
second limit, and the force command and subsequent exit observation share a
ten second limit. No graceful deadline was increased.

Passing requires the expected ten feature checks or thirteen daily checks,
no fatal or page error, and successful cleanup of every expected launch. The
owned app must still be alive when cleanup begins and must exit normally with
code 0 after a successful close request, without a force attempt. The daily
runner applies this to both the restart and the final shutdown. An early exit,
close-request failure, expired graceful deadline, nonzero exit, force attempt,
or CI firewall cleanup error fails the final result. An eventual exit code 0
does not erase an earlier failure. Console errors and bounded native stderr
remain available for review; their presence is not automatically classified
as a process-cleanup failure.

Existing `pid`, `forced`, `exitCode`, and daily `forceKilled` fields remain.
The force flags record an attempted fallback, while `taskkill` retains its
actual status, signal, error, stdout and stderr. Timestamps such as
`exitObservedAt` and `appExit.at` describe Node's observations, not an
independent OS clock. Both reports also record the shared helper's SHA-256.
If the OS refuses owned-process cleanup, the report remains failed and names
the surviving PID. The harness releases its own pipe handles so the failure
can exit; the CI cleanup step retains the outbound rule until that exact app
is gone. The rule applies to the copied application executable only.

The focused lifecycle regressions use owned Node processes and injected
cleanup-command outcomes. They cover delayed exit code 0 after a failed force
attempt, an app that remains alive, a rejected close request, early and nonzero
exit, helper deadlines, both daily outcomes, and failure before either real
runner launches an app. These tests do not establish Windows/WebView2 shutdown
behavior. Rerun both packaged native fixtures on Windows for that evidence.

## Reproducing

```
npx tauri build --no-bundle
node scripts/daily-native-smoke.mjs --exe src-tauri/target/release/news-terminal.exe
node scripts/v05-native-smoke.mjs --exe src-tauri/target/release/news-terminal.exe
```

The default prefixes include a timestamp, so new runs get new evidence paths.
Evidence lands in `docs/evidence/` as JSON plus screenshots. Neither script
touches a production data directory, and the seven `msedgewebview2.exe` child
processes observed on this host belong to another application and were left
untouched.
