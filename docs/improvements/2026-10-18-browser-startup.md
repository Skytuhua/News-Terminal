# Browser startup before journey budgets

## Observed problem

On Windows, the combined browser suite at `cd24327` passed 246 of 247 tests. The
first backup test timed out after 30 seconds in the shared fixture's initial
`page.goto("/")`, waiting for the load event before any application controls.
The second test passed in about three seconds and the remaining tests passed.
TypeScript and all 63 unit tests passed in the same acceptance run.

The harness starts Playwright immediately after Vite begins listening. Listening
does not mean the application's imports have been transformed. A fresh Linux
cache did not reproduce the Windows timeout: both backup tests passed in 3.0
seconds. Vite's debug log still showed the first navigation doing the application
transforms, including App, model and the icon bundle. The evidence supports
moving initial load work outside journey budgets; it does not isolate the
Windows delay to one particular transform or prove a performance improvement.

## Change

The Playwright configuration gives `chromium` journeys a dependency on one
`startup` test. That test loads the existing, unmocked "Desktop runtime required"
screen and waits for the load event and heading. It uses the same configured
base URL and browser executable as the journeys. No fixture data, native IPC,
product startup flag or dependency crawler is added.

Startup has a 60-second test budget. Existing journey defaults stay at 30 seconds,
with no retries added. Browser launch and teardown have separate Playwright
limits. The built-in fixtures close the startup context and browser before the
journey worker starts.

The gate rejects page errors and failed same-origin documents, scripts and
stylesheets, including HTTP errors that `page.goto` alone would not reject. A
bounded error list and elapsed navigation time are attached as
`browser-startup.json` even if navigation or rendering times out. Failed startup
also retains its trace and the existing failure screenshot.

[Playwright project dependencies](https://playwright.dev/docs/test-global-setup-teardown#option-1-project-dependencies)
apply to both harness launch paths and direct Playwright runs. Filename, grep
and project selection retain startup for selected journeys. `--list`, help and
empty test selections stay browser-free. The explicit `--no-deps` option remains
an intentional bypass. Existing server ownership, output paths and failure
annotation behavior are unchanged.

## Regression evidence

Two process regressions use a local HTTP fixture and the actual project config:

- The first script response takes seven seconds. Before the project dependency
  was added, the ordinary probe failed in `page.goto` at its five-second budget.
  With startup, the gate took 7,219 ms and the same ordinary probe passed in
  119 ms while asserting that its budget was still five seconds.
- A script returning HTTP 500 fails startup, prevents the ordinary test body
  from running, and leaves a report that the existing CI annotation script
  renders with the startup project name and the HTTP failure.

These controls passed together in 11.0 seconds on Linux with Playwright 1.63.0
and the installed Chrome for Testing 155. Their outer process used `--no-deps`
only to isolate them from the pre-existing application issue below. The nested
processes under test used the actual startup dependency. Their owned servers,
timers and child processes are closed in `finally`; subprocess tests have their
own bounded budgets.

TypeScript passed. All 19 existing harness process and failure-report tests
passed, including occupied-port ownership, output-path guards, browser-free
discovery and release of the selected port after a no-tests failure. Listing
the selected Chromium backup tests still included startup when pointed at an
absent browser installation; direct Playwright help also succeeded without a
browser. Real application acceptance is recorded separately below.

## Application error exposed by the gate

The first unmocked application run failed startup and blocked all four selected
journeys. Its trace showed `subscribeAlertStatus` calling Tauri's native event
listener without a native runtime, then rejecting because `transformCallback`
was unavailable. The notification subscription effect at `App.tsx:535` lacked
the runtime guard already used by the snapshot subscription. A separate product
fix addresses that error. This harness keeps the unmocked screen and error gate
intact; final combined Linux and fresh-cache Windows acceptance must include
that fix before this startup dependency can pass against the real application.
