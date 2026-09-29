# 0.5 native acceptance: detached-window check does not pass

## Result

`scripts/daily-native-smoke.mjs` passes **9 of 10** checks against the 0.5
release executable, with 251 synthetic stories imported through the validated
native backup API into a fresh temporary appdata directory. IPC and DOM are not
mocked. Screenshots are real native WebView2 content.

The tenth check, `real detached native window has independent pane scope`, does
not pass: `findPage` times out with "Native window target not ready".
Reproduced on three consecutive runs.

## This is not a product failure

Measured directly with Win32 `EnumWindows` and a CDP target dump at 1 Hz for
20 seconds after clicking **Detach tab**:

| Observation | Result |
|---|---|
| Workspace record | `window_context` on the main window reports `detachedTabs: [{ label: "detached-…", profileId: "default", tabId: "home" }]` |
| Native window | **Created and visible.** `hwnd 6165420`, title `News Terminal · Detached workspace`, alongside main `hwnd 60097758` |
| CDP target | **Never appears.** Exactly 1 CDP page for the whole 20 s window |

So the detach flow itself works: the tab is registered as detached and a real,
visible native window is created for it. What is missing is a **CDP target for
that secondary window**.

## Root cause

`NEWS_TERMINAL_CDP_PORT` is applied to the debugger when the main window's
WebView2 is created. A window created later, at detach time, does not pick up
the remote-debugging endpoint, so it never appears as a CDP page.

CDP here is a **test-only affordance** driven by an environment variable. A
real user never sets it and is unaffected: they get a real window. The harness
simply cannot *observe* that window, because observing it requires exactly the
capability the secondary window lacks.

This is therefore a coverage gap in the instrumentation, not a defect in the
product — and it is deliberately **not** recorded as a pass.

## Not done, and why

Two ways to close this, neither taken here:

1. **Weaken the check** to assert only on the workspace record and the Win32
   window. This would go green immediately but would drop every assertion about
   the detached window's *pane scope*, which is the thing the check exists to
   prove. Not taken.
2. **Apply the CDP endpoint to windows created after startup**, in the Rust
   window-creation path. This restores the full assertion strength and is the
   correct fix, but it is a change to the host's test affordance and belongs in
   its own change with its own review — not folded into a test-harness commit.

## Related finding from the same investigation

`cargo build --release` does **not** embed the frontend. A binary produced that
way launches, connects to CDP, and serves `about:blank` or
`chrome-error://chromewebdata/`, so every native check fails at launch with
"Native window target not ready". `npx tauri build` is required. This produced
a misleading failure that looked like a broken product.

Seven `msedgewebview2.exe` processes were observed lingering on the host. They
were confirmed to hold the **same PIDs across every run**, so they predate this
work and belong to another application. They were deliberately not terminated.

## What this does and does not establish

- It **does** establish that 0.5 did not regress the existing daily native
  workflow: pagination, Hide/Undo host flags, J/K page crossing, search
  reach, and per-tab pane scoping all pass on the real 0.5 build.
- It **does not** constitute native acceptance of any 0.5 feature. The smoke
  has no checks for bulk triage, the X/M/Escape shortcuts, alert receipts,
  source search, or cache disclosure. 0.5.0 is not releasable on this evidence.
