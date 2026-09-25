# Real Windows smoke test

Run from the repository root after building:

```sh
npm run tauri -- build --no-bundle
node scripts/native-smoke.mjs
```

An alternate executable can be passed as the first argument. This runs the actual Tauri Windows process and connects Playwright to its real WebView2 via a temporary debug endpoint. It does not inject an IPC fixture. The script gives the process a fresh `NEWS_TERMINAL_DATA_DIR` in Windows Temp, then closes its own process tree. It never uses the normal application's database.

## Exercised behavior

- Launch through the real Rust host into the fully loaded React reader, not just the loading screen.
- Real publisher-feed retrieval, status reporting, visible/selectable actual story, permitted excerpt and original-link control.
- Cached SQLite FTS latency, 50 persisted tabs, process-tree working sets. These are local measurements, not universal performance guarantees; working sets may count shared pages more than once.
- Profile-isolated saved/read state.
- Actual detached native WebView, retained selected article, real reattach.
- Saved cache remains usable after source failure, with sources disabled before restart. Browser offline emulation alone does **not** disable Rust networking; the evidence explicitly says so.
- Crash/restart saves and native window/profile restoration.
- Missing-monitor recovery by injecting offscreen coordinates into only the test data directory's saved layout.
- Backup rejection leaves data intact; valid import removes orphan profile/window ownership, which stays removed across restart.
- Unsafe URL opening and unconfigured AI fail safely.
- Available-monitor enumeration and real window restoration on each attached monitor. The verified machine has a 150% primary display, a 100% portrait display on the right, and a 100% display at negative x coordinates. The script records the actual monitor work areas and positions rather than assuming that setup.

## Evidence

`docs/evidence/native-smoke.json` contains the most recent run, including pass/fail, timestamps, executable path, isolated data directory, source status, timing, memory, and monitor results. Screenshots:

- `native-reader.png`: actual loaded reader and selected story.
- `native-detached.png`: actual second native window.
- `native-main.png`: main window after detach.
- `native-monitor-*.png`: reader restored on each connected monitor.

Re-run against the final rebuilt release; intermediate evidence does not certify later edits. The original smoke suite missed stale ownership and accepted the loading `<main>` too early. Regression coverage now checks ownership across import/restart and waits for the reader's workspace tablist.

## Separate checks and limits

Browser E2E tests intentionally use labeled fixtures for deterministic editing, inaccessible-source, summary and keyboard cases. Rust tests exercise quiet hours and notification delivery decisions. Live cloud inference needs user-configured credentials and is not claimed by fixture tests. OS notification banner visibility depends on Windows notification/Focus Assist settings; backend delivery success is not proof that a person saw a banner. Live model inference and hardware at 200% DPI must be distinguished from simulated UI scaling checks.

The debug endpoint is enabled only through the test subprocess environment. Do not run the test with personal reading data or expose that port to other machines.
