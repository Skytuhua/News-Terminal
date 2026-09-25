# Daily-use performance baseline

## Outcome

The browser UI becomes noticeably blocking at the ordinary cache ceiling, **before native database or network latency is involved**. In the bounded 5,000-story synthetic fixture, median cached reload was **1,461.6 ms**, selecting the first unread story **1,826.0 ms**, search **2,221.3 ms**, and an immediate-success/no-change refresh **4,435.9 ms**. The renderer mounted **5,000 rows / 51,945 DOM elements**. A refresh interaction contained a **1,686 ms main-thread long task**.

No production code, dependencies, native database, installed app, installer, local AI runtime, or existing tests were changed. These are browser measurements, **not native Tauri/WebView2 startup, SQLite/FTS, feed refresh, or AI throughput measurements**.

## Evidence and reproduction

- Harness: [`../scripts/daily-performance-probe.mjs`](../scripts/daily-performance-probe.mjs).
- Primary raw run: [`evidence/daily-performance-results.json`](evidence/daily-performance-results.json), including every sample, operation count, fixture dispatch duration, source SHA-256, browser asset transfer sizes and long tasks.
- Aggregated primary run: [`evidence/daily-performance-summary.json`](evidence/daily-performance-summary.json).
- Initial harness smoke run: [`evidence/daily-performance-smoke.json`](evidence/daily-performance-smoke.json), **not pooled into the primary figures**.
- Primary run: **2026-09-24 04:54:36.856–04:56:52.692 UTC**. Nine list trials, four live-poll scenarios, zero browser page errors. Tracked input fingerprints were unchanged during the primary run. The graph report was read first; its commit and the checkout HEAD both identify `a85405469939361f2512266ee3f4b21240ac7e8e`. Source files are also fingerprinted because the working tree contains uncommitted/untracked project files; HEAD alone does not identify the measured build.

From the repository directory, using already installed packages/browser:

```bash
node --check scripts/daily-performance-probe.mjs
node scripts/daily-performance-probe.mjs
# Quick focused rerun; keeps the original evidence:
node scripts/daily-performance-probe.mjs --sizes=5000 --trials=3 --port=4179 --output=docs/evidence/daily-performance-after.json
# Small harness smoke, not a replacement for the ceiling-scale run:
node scripts/daily-performance-probe.mjs --sizes=500 --trials=1 --port=4179 --output=docs/evidence/daily-performance-smoke-new.json
```

The script builds in memory with Vite, binds **only its own localhost port 4179**, health-checks it, launches isolated headless Chromium contexts and closes its browser/server in `finally`. A port conflict fails rather than reusing an unknown service. It does not use port 1420 or 11434, existing browser profiles, existing Playwright tests, or external feeds. `MODE=test` retains the existing test-only IPC injection seam; Vite build uses minification and production React, not the development/HMR path. Nothing is written to `dist`.

### Environment and data

- Windows `10.0.26200`, x64; AMD Ryzen AI 9 HX 370; 24 logical CPUs.
- Physical memory: 33,412,722,688 bytes; available at primary-run start: 15,912,755,200 bytes. Other processes were not suspended; these are not exclusive-machine lab results.
- Node `v24.14.0`, installed Playwright `1.63.0`, Vite `6.4.3`, React `19.3.0`; headless Chromium `153.0.8010.12`.
- 1440 × 1000 viewport; no CPU/network throttling; reduced-motion preference for list trials.
- Deterministic **synthetic** fixtures: 500 / 2,000 / 5,000 stories, 19 enabled sources, one profile/tab, repeated short excerpts, mostly three-story related groups, one opinion per four stories, one `needle` search match per ten, saved flag per twenty, no media or history, AI disabled. These are scale fixtures, not a replay of the user's feed mix or a claim of comprehensive real-world representativeness.
- Fixture calls use in-browser `structuredClone`, not Tauri serialization or Rust. Mutation broadcasts intentionally reproduce the host's successful workspace/article/refresh `data-changed` notification plus the UI's explicit readback. The fixture omits the native visit broadcast, so startup call counts are deliberately simplified.
- Three independently launched browsers per scale. Each trial measures a fresh-context navigation, then a same-context cached reload. Asset transfer evidence for the first sample at each scale: **329,237 resource bytes fresh, zero on reload**. Browser launch time is excluded; OS disk caches were **not** cleared. “Fresh” means a fresh browser/context HTTP cache, **not cold Windows/native launch**. Even the first smoke-run startup (about 760 ms at 500 rows) is not proof of OS-cold performance.

## Measured browser results

All table entries are **median milliseconds [minimum–maximum], n=3**. Start/end include Playwright actionability/driver overhead and end at the expected DOM state plus two animation frames; they are practical scripted interaction times, **not React commit durations or INP**. Search includes the application's 180 ms debounce. Refresh below is an immediate synthetic response, with zero real feed requests.

| Operation | 500 stories | 2,000 stories | 5,000 stories |
|---|---:|---:|---:|
| Fresh-context navigation | 201.9 [181.7–217.1] | 460.9 [460.2–500.6] | 1,613.7 [1,529.0–1,744.5] |
| Cached same-context reload | 113.4 [112.4–114.1] | 441.1 [433.7–482.2] | 1,461.6 [1,397.2–1,677.6] |
| Select first unread story | 129.8 [129.0–147.0] | 490.8 [480.6–507.9] | 1,826.0 [1,796.9–2,027.8] |
| Filter to opinion | 76.2 [69.2–90.1] | 426.7 [421.0–450.0] | 2,306.0 [2,296.2–2,604.9] |
| Restore all types | 79.9 [79.8–95.6] | 330.1 [328.8–363.5] | 1,414.4 [1,378.8–1,443.5] |
| Search `needle`, first ready results | 263.6 [262.1–293.9] | 424.7 [423.2–432.5] | 2,221.3 [2,040.5–2,316.0] |
| Clear search, full list | 96.0 [80.6–97.2] | 312.6 [297.2–313.3] | 2,160.5 [2,124.3–2,798.8] |
| Synthetic no-change refresh | 182.3 [176.3–184.3] | 1,007.5 [911.8–1,016.6] | 4,435.9 [4,426.7–5,188.4] |

| Mounted initial list | 500 stories | 2,000 stories | 5,000 stories |
|---|---:|---:|---:|
| DOM element count | 5,370 | 20,895 | 51,945 |
| Serialized fixture snapshot bytes | 391,557 | 1,549,404 | 3,870,098 |
| Median fixture snapshot clone time, ms | 1.0 | 3.95 | 10.1 |

The clone measurements are only JavaScript fixture costs. The much larger interaction timings demonstrate browser work beyond fixture cloning; they do not quantify SQLite, IPC, or native lock contention. Long-task measurements are observational, not exhaustive profiling; short polling windows, observer delivery and driver overhead mean they cannot be subtracted from interaction duration to derive a precise “React time.” No p95 claim is made from three repetitions.

### Redundant request reproduction

Observed in **every primary trial**:

- Select one unread story: **4 snapshots, 4 window-context reads, 1 article-state write, 1 workspace save** by measured completion. `select()` invokes both `patchTab()` and `action()`; each mutation also emits a change event. Generation checks discard stale responses but do not prevent already-issued work.
- Type one search and allow its workspace save to settle: **2 identical search calls**. The effect depends on `data?.articles`, and snapshots replace that array even when searchable content is unchanged.
- Emit one unchanged `data-changed` while a search is active: **1 snapshot, 1 context read, 1 repeat search**. Its raw ~700 ms observation field includes an intentional 700 ms wait; **do not report that field as latency**.
- Immediate no-change refresh: **2 snapshots and 2 context reads**. One comes through the event subscriber and another from `refresh()`'s explicit `load()`.
- Persisting a search can involve **3 snapshots**: workspace pre-read, mutation event reload and explicit post-save reload. At small scales this happens after first results; at 5,000 rows it appears inside the measured interaction.

At the 5,000-row fixture size, four snapshots represent **15,480,392 bytes of repeated equivalent JSON payload** by calculation. This is a data-volume illustration, **not measured native wire traffic**; actual returned states and Rust serialization sizes differ.

## Source-level findings and native boundaries

References are to the fingerprinted source read during this baseline; concurrent feature work may subsequently move line numbers.

### List work is not bounded by viewport

- `src/App.tsx:430–440,979–1023`: new accepted-ID set, filters and **every row** are built in `App` render; no pagination/virtualization or memoized row boundary.
- `src/App.tsx:1009–1015`: each rendered row filters the **entire** article array to count its group, then repeats the scan when a group has multiple members. This is quadratic in the all-headlines view. Selection, search input, status updates and pane-width state all reach this render path.
- `src/App.tsx:992–998` and `src/model.ts:33–35`: repeated locale date/time formatting per row adds work, but its isolated cost was not measured; it is not asserted to dominate.
- `src/App.tsx:133–138`: a full article-content fingerprint is JSON-stringified on each load, including loads while the briefing is not visible. This protects briefing invalidation but adds full-cache work.

**Isolated algorithm experiment, not a modified app:** the probe executes the exact two-filter related-count logic versus building a `Map<groupId,count>` once, after warm-up, five repetitions. Both produce identical checksums.

| Synthetic scale | Original median | Single-map median |
|---|---:|---:|
| 500 | 4.7 ms | below timer resolution (reported 0.0 ms) |
| 2,000 | 44.8 ms | 0.1 ms |
| 5,000 | 287.0 ms | 0.2 ms |

This validates eliminating the repeated scan; **it is not evidence that the full UI becomes that many times faster**. DOM work and repeated renders remain.

### Snapshots are not strictly capped at 5,000

- `src-tauri/src/db.rs:556–575`: search SQL has `LIMIT 5000`. The non-search query returns the newest 5,000 **OR any saved story for the profile**, with no outer limit. Older saves can therefore take the snapshot above 5,000. The comment in `App.tsx:428` is not a hard memory/UI bound.
- Snapshot construction (`db.rs:1030–1032`) reads documents and articles, merges per-profile state, and reranks the collection on every call. `Backend::database()` (`lib.rs:127–130`) uses a shared mutex. Native repeated reads therefore repeat real database/ranking work, not just frontend cloning.
- `src-tauri/src/intelligence.rs:26–118`: ranking lowercases title/excerpt repeatedly, sorts, then repeatedly scans/removes from a vector for the diversity cap. The greedy removal loop has quadratic worst-case movement. **Native ranking time was not measured**, so this is a source-level risk, not a measured bottleneck ranking above the browser issues.
- `App.tsx:251–280` requests the full snapshot merely to acquire workspace revision/state before saving, then reloads afterwards. A future narrow workspace read would avoid article work but needs to preserve compare-and-swap revision conflict handling.

### Refresh is bounded network work, but notifications amplify rereads

- `lib.rs:575–647`: one global refresh guard, four concurrent feed jobs, due-source selection, per-source policy checks, then retention. This is **not one separate RSS fetch loop per window**.
- `db.rs:879–890`: source interval defaults to 30 minutes and clamps to 5–1,440 minutes; retry cooldown and last attempt are honored even for manual refresh.
- `services.rs:477–518`: bounded connect/request/DNS handling; whole feed operation has a 20-second timeout. No external feed timing was measured by this task.
- `lib.rs:709–715` broadcasts successful mutations. The scheduler (`lib.rs:729–732`) runs at startup and sleeps 60 seconds **after each completed pass**; a successful scheduled pass emits `data-changed` even if no source is due and no article changes. All subscribed windows then reload context/snapshot. At rest, expected amplification is one reload per window per successful scheduled pass, not an independent per-window feed fetch.
- No native no-op scheduler pass was timed here. Optimizations must still propagate source-health, retention, permission and workspace changes; `updated == 0` alone is not a safe “nothing changed” test.

### Live discussion polling scales with windows, not streams

`src/LiveDiscussion.tsx:20–46` performs a full local `live_status` read on mount and schedules another 1,000 ms after completion, even when status is off. It accepts/replaces rows and updates checked time on each response. The effect cleans up on unmount but does not inspect document visibility. `src-tauri/src/live.rs:15–22,95–99` holds one shared native desk and clones its status for each caller. **Additional windows do not prove additional upstream streams.**

Observed in isolated browser contexts using the actual LiveDiscussion component, **not real native windows**:

| Synthetic status | Browser windows | Observation | Incremental status reads | Equivalent JSON payload returned |
|---|---:|---:|---:|---:|
| Off, 0 rows | 1 | 5,213 ms | 5 | 595 bytes |
| Off, 0 rows | 3 | 5,214 ms | 15 | 1,785 bytes |
| Connected, 100 unchanged rows | 1 | 5,210 ms | 5 | 119,365 bytes |
| Connected, 100 unchanged rows | 3 | 5,204 ms | 15 | 358,095 bytes |

Each off payload was 119 bytes; each 100-row payload 23,873 bytes. Payload totals are calculated from the fixture JSON byte length and observed calls, not IPC bandwidth. Calls in this window exclude the initial mount read; per-window raw fixture duration samples include it. All pages reported `visible`. Hidden/minimized WebView2 throttling and native CPU/battery cost were **not measured**. This is a lower-priority steady-state cleanup than the multi-second list stalls.

## Four prioritized minimal fixes — proposed only

1. **Precompute related-group counts and isolate unchanged list work.** Replace the per-row two full-array scans with one memoized count map; memoize the row/list projection on its real inputs rather than unrelated `App` state. Preserve original counts across hidden/filtered rows. This has directly validated algorithmic benefit and no dependency requirement. Regression: same group labels/checksums and read/saved state, then rerun the 5,000-story probe. Do not claim the microbenchmark ratio as UI speedup.
2. **Bound mounted headline rows without dropping cached/saved data.** Prefer a simple explicit page/load-more slice before adding a virtualizer dependency. Keep all stories searchable and reachable; selection, J/K navigation, scroll anchoring, pending-new-story acceptance and accessibility must cross page boundaries correctly. Saved stories make the total snapshot exceed 5,000, so merely relying on the SQL comment is insufficient. Regression: bounded DOM row count at 5,000+saved rows, with a reachable final story and preserved selected ID. The current probe's full-DOM-count assertions deliberately need updating alongside such a UX change; they must not be silently disabled.
3. **Coalesce redundant reloads and preserve unchanged article identity.** Keep one in-flight snapshot load with a dirty follow-up for truly newer events, and reconcile unchanged article data so workspace/status-only readbacks do not restart the search effect. Preserve generation/profile/import safeguards and mandatory authoritative post-write confirmation. Regression targets: no duplicate identical search from query persistence, one authoritative refresh readback per generation, fewer snapshots per unread selection without losing concurrent-window updates. A narrow workspace read is a follow-on only if measured native cost still warrants it; avoid introducing a general caching layer first.
4. **Reduce idle live-status work.** Back off when off/hidden, immediately recheck on visibility restoration, and reuse unchanged item identities so the 100-row list does not rerender for timestamp-only status changes. Keep one native stream and honest checked-time/error reporting. Regression: enabled polling still delivers changes, disconnect works after read failure, unmount cancels timers, and multiple views observe the shared toggle. Measure one/three-window call counts again; do not extrapolate these visible-browser results to battery savings.

### Regression commands and acceptance discipline

The benchmark commands above were actually run. Existing regressions below are suggested follow-up gates for implementation; this analysis did **not** rerun or claim the entire production suite:

```bash
npm run typecheck
npm test
# Existing browser tests; only after coordinating/releasing port 1420:
npm run test:e2e -- tests/e2e/reader.spec.ts tests/e2e/keyboard-scroll.spec.ts tests/e2e/stable-layout.spec.ts tests/e2e/races.spec.ts tests/e2e/tab-selection.spec.ts tests/e2e/v02-live.spec.ts tests/e2e/v02-detached.spec.ts
```

Keep baseline and after-run JSON separate; compare medians/ranges on the same device, build mode, sizes and viewport. Request counts and reachable stories are deterministic regression gates; timing budgets require repeated measurements on a controlled machine. A native follow-up should use an isolated `NEWS_TERMINAL_DATA_DIR`, test saved-overflow/ranking/FTS and real multiwindow snapshots, and separately label first process launch versus warm cached reads. It must not repurpose the user's live database or local AI service.

## Limitations / handoff

No native latency, real source refresh, cold-OS startup, sustained typing/INP, CPU attribution profile, hidden-window behavior, very large saved collections, full article history/media payload, or battery claim is supported by this run. These gaps are explicit rather than filled with estimated timings. The repository's research-capture rule points to `C:/Users/user/.Codex/rules/common/research-capture.md`, but that file is unavailable; a targeted lookup under `Documents/Codex` also found no copy. No Mission Control write was made, consistent with this task's explicitly owned files. The parent can capture this completed report using its established workflow if available.
