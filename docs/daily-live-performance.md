# Live discussion idle polling

## Outcome and scope

`LiveDiscussion` now waits **5 seconds after a completed local status read while off or hidden**, retaining **1 second while visible and enabled**. Mount, explicit retry and completed connect/disconnect actions still read immediately. Returning to a visible document or focusing a visible window rechecks immediately, without waiting for the idle timer. An already-running read is reused rather than overlapped.

Only `src/LiveDiscussion.tsx`, `tests/e2e/daily-live-polling.spec.ts`, and this document were changed by this task. No dependencies, App, shared fixtures, styles, native services or upstream stream behavior were changed. The native stream remains shared and is **not disconnected when the view is hidden or unmounted**. This is local renderer polling backoff, not an RSS/SSE network scheduling change.

Successful responses still refresh status and the local checked time. Read errors retain the previous checked time and report potentially stale items. Unknown initial state still offers unconditional Disconnect; a failed read never invents an off state. Confirmed disconnect resets the accepted snapshot so a later remote reconnect accepts its first snapshot; subsequent arrivals remain behind Show latest.

Unchanged accepted items reuse their objects and list identity after comparing every `LiveItem` field. A memoized list and stable open callback avoid rebuilding/formatting unchanged rows when only the checked time or status changes. Accepted-ID indexing is memoized as well. Removals and changed title, author, score, timestamps and URLs still apply without reordering the reader's accepted list.

## Actual browser measurements

Final run: **2026-09-24, approximately 05:25–05:26 UTC**, isolated headless Chromium, Windows, Node `v24.14.0`, Playwright `1.63.0`, Vite `6.4.3`, React `19.3.0`. The final server served a frozen, minified Vite `--mode test` build from a temporary directory, not HMR. This preserves the test-only fixture IPC seam while using production React. The test server bound only `127.0.0.1:4187` with strict-port checking; no existing browser profile or native database was used.

Source SHA-256 for the final verified `src/LiveDiscussion.tsx`:

```text
4d58b58c58b718a6ebe69d6179396e69e6a9ef046167519d1e8d19747131338c
```

Counts exclude mount/setup reads and are incremental calls to the **real component's** fixture-backed `live_status` dispatcher during a requested 5,200 ms observation. All visible scenarios asserted `document.visibilityState === "visible"`. Connected measurements used 100 unchanged synthetic items per view. Each multi-window sample used three independent isolated browser contexts; they measure per-view reads, **not three actual native windows or a shared Rust backend**.

| State | Views | Actual observation, ms | Reads per view | Total reads | Earlier baseline total |
|---|---:|---:|---|---:|---:|
| Visible, off | 1 | 5208.0077 | 1 | 1 | 5 |
| Visible, off | 3 | 5217.5848 | 1 / 1 / 1 | 3 | 15 |
| Visible, connected, 100 items | 1 | 5212.3601 | 5 | 5 | 5 |
| Visible, connected, 100 items | 3 | 5215.2773 | 5 / 5 / 5 | 15 | 15 |
| Synthetic hidden, connected, 1 item | 1 | 5217.3099 | 1 | 1 | Not measured in earlier baseline |

Earlier baseline values come from [daily-performance-baseline.md](daily-performance-baseline.md#live-discussion-polling-scales-with-windows-not-streams), whose observation lengths were approximately 5.2 seconds. These are individual samples, not medians or CPU timing measurements. The new tests log raw measurements and attach JSON to the Playwright result. Connected assertions tolerate timer/scheduling phase variation; the observed final values above were exactly five per view.

Hidden behavior is tested by overriding `document.visibilityState` and dispatching `visibilitychange`. This verifies the application's scheduling policy deterministically, **not actual minimized WebView2 timer throttling**. Remote toggles use the existing fixture dispatcher directly, representing another caller changing shared state. No battery, native CPU, native serialization cost, upstream connection count or real background-window savings were measured or inferred.

## TDD and regression evidence

The behavioral changes were introduced in vertical RED → GREEN steps:

- Off backoff: new test first failed with **5 reads / 5210.8364 ms**, expecting 1; passed after idle scheduling changed.
- Hidden backoff: new test first failed with **5 reads / 5217.6536 ms**, expecting 1; passed after visibility-aware scheduling.
- Visibility and focus restoration: both first failed with **1 total read instead of 2** immediately after restoration; passed after wake listeners were added.
- Unchanged list work: a timestamp-specific `Date.prototype.toLocaleString` probe first recorded **1 extra row formatting call instead of 0** after an unchanged status poll. After reconciliation and memoization it recorded **0**. This is evidence that row rendering work was skipped, not a timing speedup estimate. The same test then verifies pending arrivals, acceptance, metadata/URL correction and removal.

Final verification:

- **10 new polling tests passed**, including one/three-view measurements, remote-enable discovery within the bounded off cadence, immediate visibility/focus checks, unchanged row work, honest failure/checked-time handling, no overlapping reads during focus bursts, and removal of timers/listeners after unmount with an in-flight read.
- **5 existing LiveDiscussion tests passed**: the two `v02-live.spec.ts` cases plus unknown-status disconnect and same-view/remote-window reconnect from `v02-review-regressions.spec.ts`.
- Combined final isolated browser run: **15 passed**.
- `npm run typecheck`: passed.
- `npm test`: **3 files / 9 tests passed** at verification time.
- Existing regression screenshots for unknown status and connected/reconnected status were captured and inspected at 1440 × 960. The revised disclosure wraps without overlapping the controls; unconditional Disconnect and both error messages remain visible. No mobile/native screenshot claim is made.

One earlier development-server run lost the action-error UI in an existing regression during concurrent workspace edits. Its cause was not proven; the same two existing tests then passed three consecutive repetitions. Final verification used a frozen build to remove HMR interference and all 15 passed. An intermediate typecheck also encountered another worker's temporarily missing `reconcileArticles` / `coalescedRead`; no out-of-scope fix was made, and the final project typecheck passed. Vite warns that the temporary output directory is outside the project and is not emptied; this does not affect the test result or alter project `dist`.

## Reproduction

From the repository, with dependencies/browser already installed and port 1420 available:

```bash
npm run typecheck
npm test
npx playwright test tests/e2e/daily-live-polling.spec.ts tests/e2e/v02-live.spec.ts tests/e2e/v02-review-regressions.spec.ts --workers=1 --grep 'visible off:|restoration rechecks|unchanged items|hidden connected|visible connected:|failed reads|focus bursts|fixture:|unknown live|reconnect'
```

The final isolated run instead used this temporary config, at `C:/Users/user/AppData/Local/Temp/daily-live-playwright.config.mjs` (not added to the repository):

```js
export default {
  testDir: 'C:/Users/user/Documents/News Terminal/tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  outputDir: 'C:/Users/user/AppData/Local/Temp/daily-live-test-results',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js build --mode test --outDir C:/Users/user/AppData/Local/Temp/daily-live-browser-build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4187 --strictPort --outDir C:/Users/user/AppData/Local/Temp/daily-live-browser-build',
    cwd: 'C:/Users/user/Documents/News Terminal',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
  },
  reporter: [['list']],
};
```

```bash
npx playwright test --config C:/Users/user/AppData/Local/Temp/daily-live-playwright.config.mjs daily-live-polling.spec.ts v02-live.spec.ts v02-review-regressions.spec.ts --grep 'visible off:|restoration rechecks|unchanged items|hidden connected|visible connected:|failed reads|focus bursts|fixture:|unknown live|reconnect'
```

Playwright stops its own preview server after the run. Temporary build/results/config can be removed separately; they are not application data. The remaining native CPU/battery/background-window questions require a separate isolated native measurement rather than extrapolation from these browser call counts.
