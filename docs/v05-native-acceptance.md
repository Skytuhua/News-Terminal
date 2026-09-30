# 0.5 native acceptance: detached-window check does not pass

## Result

`scripts/daily-native-smoke.mjs` passes **13 of 13** checks against the 0.5
release executable, including `real detached native window has independent pane
scope` and `reattach restores same tab main widths without copying detached
preferences`. `scripts/v05-native-smoke.mjs` passes **10 of 10** twice
consecutively, with a clean exit code 0.

Both runs use the real release executable, an isolated temporary appdata
directory, synthetic fixtures imported through the validated backup API, and no
mocked IPC or DOM. Source of truth is the executable built by
`npx tauri build --no-bundle`; a plain `cargo build --release` does not embed
the frontend assets and serves `about:blank`, which fails every check at launch.

## Resolved: the detached window was invisible to CDP

The detached-window check previously never reached a ready CDP target. The
window itself was never broken. Instrumentation showed all three of:

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
  was still 430. It now waits for the width to settle before asserting.

Neither change weakened an assertion: the expected values are unchanged, only
the waiting and the addressing.

## Resolved: the exit code 1 was the harness

The app also appeared to exit with code 1 in several runs. Attribution
timestamps proved the app was alive and idle when the smoke's own `finally`
block ran `taskkill /F` on it, 400 ms after cleanup began. Exit code 1 is what
taskkill produces; there was no crash. Cleanup now sends `WM_CLOSE` to the owned
window, as the 0.3-era smoke already did, and only force-kills if that is
ignored. Two consecutive runs close gracefully with exit code 0.

## Reproducing

```
npx tauri build --no-bundle
node scripts/daily-native-smoke.mjs --exe src-tauri/target/release/news-terminal.exe --prefix daily-native-v05
node scripts/v05-native-smoke.mjs --prefix v05-native
```

Evidence lands in `docs/evidence/` as JSON plus screenshots. Neither script
touches a production data directory, and the seven `msedgewebview2.exe` child
processes observed on this host belong to another application and were left
untouched.
