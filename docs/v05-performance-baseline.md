# 0.5 frontend performance baseline

Scope: the frontend costs left unmeasured by `docs/daily-performance-baseline.md` (0.3-era
list work) and `docs/v04-performance-baseline.md` + `docs/v04-ranking.md` (0.4 native ranking
and snapshot). Nothing in this document re-measures or re-claims the native ranking win
(554ms → 21ms) or the daily browser reload/unread/search baselines.

- Probe: `scripts/v05-performance-probe.mjs`
- Evidence: `docs/evidence/v05-performance-run2.json` (9 trials, 0 browser page errors)
- Run: 2026-09-26, git `74c36cce3f4859f459ae602a2a7bddf1b27b53a2`, source hashes unchanged
  across the run (`changedDuringRun: []`)
- Host: Windows 11, AMD Ryzen AI 9 HX 370, Node v26.7.0, headless Chromium 153.0.8010.12,
  viewport 1440×1000, `reducedMotion: reduce`, no CPU throttling

Reproduce with:

```
node scripts/v05-performance-probe.mjs --trials=9 --port=4183 \
  --output=docs/evidence/v05-performance-run3.json
```

The probe refuses to overwrite an existing evidence file, so each run needs a new `--output`.

## What was measured, and what it is not

This is a **synthetic browser fixture** against the real production frontend bundle. A
synthetic in-page IPC fixture answers `dispatch` calls; no Tauri window, no SQLite, no
network, no feed fetch, no AI provider and no user profile are involved. The app code under
test is the shipped code — same `App.tsx`, `model.ts`, `Briefing.tsx`, `SectorSummary.tsx` and
the rest, built by Vite in production mode (production React, minified, no sourcemaps,
nothing written to `dist/`).

Fixture: 5000 stories across 19 sources, 10 languages with long multilingual headlines,
mixed kinds/topics/sections, related groups of 1–5, 33% read / 4% saved / 2.7% hidden, media
permissions per story, 14 briefing sectors × 25 items, 100 live items, 2 profiles, 3 tabs.
Counts are asserted against closed-form expectations derived in Node from the same rules the
in-page generator uses (4864 visible, 486 search hits for `needle`, 194 saved), so a change
to the distribution cannot silently invalidate a run.

Each trial launches a **fresh headless Chromium process**. Within a trial, the cold
measurement gets a fresh context (empty HTTP cache) and the interaction battery gets a second
fresh context, so interaction timings never inherit cold-start JIT state.

## Bundle size (production build, exact bytes)

| Asset | Raw | gzip |
|---|---:|---:|
| `assets/index-BOZq3BTs.js` | 350,047 | 104,842 |
| `assets/index-gqOWMtcv.css` | 25,237 | 5,572 |
| `index.html` | 446 | 281 |

Bundle size is not a bottleneck: ~105KB gzipped JS, parsed from a local in-memory server with
no network latency. The costs below are all main-thread work, not transfer.

## Results — 9 trials, median [p25–p75], min–max

### Cold start (fresh context, empty HTTP cache)

| Metric | Median [p25–p75] | Min–Max |
|---|---|---|
| DOMContentLoaded | 222 [135–793] ms | 117–7826 |
| First contentful paint | 188 [140–396] ms | 92–7840 |
| LCP | 476 [356–780] ms | 288–7840 |
| Rows ready (4864 stories resolved, 100 mounted) | 479 [353–835] ms | 295–7846 |
| Navigation → painted frames | 506 [468–852] ms | 320–7852 |
| Long tasks (whole cold load) | 0–1 | 0–227 ms total |
| DOM elements at first paint | 1494 | 1494 (all trials) |

Cold start is dominated by **main-thread JavaScript, not paint**: FCP at a 188ms median
against a 476ms LCP means content appears early and the list only settles roughly 290ms later.
The trial-1 outlier (7.8s) is first-run JIT plus OS file-cache warming on an idle machine and
is excluded from every conclusion below; medians are the reported statistic for that reason.

**Fixture cost is reported separately and is not app cost.** The fixture is constructed in an
init script, so it runs on the main thread before any app code: median 56ms [47–80], 1–28% of
the rows-ready time. It is synthetic overhead inside the cold number, which is why cold
medians are an upper bound on real startup.

### Interaction battery (median [p25–p75], min–max)

| Step | Wall time | Long-task total | Longest | DOM |
|---|---|---|---|---:|
| Cached reload, same context | 276 [223–434] ms | 67 ms | 67 ms | 1494 |
| Tab → brief desk | 137 [116–156] ms | 70 ms | 70 ms | 1494 |
| Tab → all headlines | 128 [113–130] ms | 62 ms | 62 ms | 1494 |
| Tab → saved desk | 150 [130–175] ms | 77 ms | 77 ms | 1670 |
| Tab → all headlines (2nd) | 150 [135–160] ms | 70 ms | 70 ms | 1494 |
| Profile → desk B | 113 [111–155] ms | 0 ms | 0 ms | 1495 |
| Profile → default | 109 [96–126] ms | 0 ms | 0 ms | 1494 |
| Clear search → full list | 79 [73–85] ms | 0 ms | 0 ms | 1494 |
| Open first story (reader pane mount) | 262 [185–271] ms | 126 ms | 126 ms | 1551 |
| Reader content switch (2nd story) | 307 [212–371] ms | 176 ms | 176 ms | 1574 |
| **Switch to Daily briefing** | **809 [511–906] ms** | **592 ms** | **592 ms** | **5233** |
| Switch to Live discussion | 356 [266–393] ms | 165 ms | 165 ms | 2120 |
| Back to all headlines | 226 [216–292] ms | 128 ms | 128 ms | 1574 |
| No-op refresh cycle 1 | 221 [154–295] ms | 107 ms | 107 ms | 1574 |
| No-op refresh cycle 2 | 198 [158–352] ms | 92 ms | 92 ms | 1574 |
| No-op refresh cycle 3 | 152 [143–333] ms | 89 ms | 89 ms | 1574 |

### Typing in search (`needle`, 6 keystrokes, 70ms inter-key gap)

| Metric | Median [p25–p75] | Min–Max |
|---|---|---|
| Input→paint latency, median keystroke | 15.5 [14.7–17.4] ms | 12.6–20.6 |
| p90 keystroke | 25.2 [19.7–28.6] ms | 18.2–31.1 |
| Keystrokes over 16ms | 2 [2–3] of 6 | 1–4 |
| Keystrokes over 50ms | 0 | 0 |
| Long tasks during typing | 0–1 | up to 170ms |

Latency is measured **inside the page** (keydown → two animation frames), so no CDP round
trip is attributed to the main thread. Typing is not a problem: no keystroke exceeded 31ms
and none exceeded 50ms. The 180ms search debounce means the query mostly costs one dispatch,
not one per keystroke.

## Where the time actually goes

Per-render and per-load expression costs, measured in isolation on the live fixture (median of
5 in-page runs, 5000 articles). **These are not application speedups and are not additive.**

| Expression | Median | Min–Max |
|---|---:|---|
| `model.ts` `reconcileArticles` — double `JSON.stringify` over all rows | 31.4 ms | 24.6–40.8 |
| `App.tsx` `searchRevision` JSON fingerprint (per data change) | 21.7 ms | 14.2–34.5 |
| `model.ts` `date()`+`compactDate()` for 100 mounted rows | 18.8 ms | 4.3–19.5 |
| `App.tsx` `briefingInput` full-cache JSON fingerprint (per load) | 8.8 ms | 8.2–18.5 |
| `App.tsx` per-render `navigationRows` filter + Set rebuild (5 renders) | 3.7 ms | 3.1–6.4 |
| `Coverage.tsx` related-coverage scan (5 renders) | 0.9 ms | 0.7–1.1 |

`reconcileArticles` + `searchRevision` together are **~53ms of pure serialization per data
change** on the main thread at this cache size. Every refresh, read-marker write, profile
switch and article-state change runs both. This is the mechanism behind the ~90–180ms
long tasks seen on tab switch, reader open and no-op refresh.

The briefing's isolated dispatch fan-out measured only **0.8ms** against the fixture
(0.5ms `daily_brief` + 0.3ms for 14 `sector_summary_preview`), which proves the point: the
fixture answers from memory. The 809ms briefing cost is **DOM and native work, not dispatch
overhead** — see the limits section.

## Recommended optimizations (2)

### 1. Gate `sector_summary_preview` behind the disclosure that uses it

**Measured:** Daily briefing switch = 809ms median, of which a **single 592ms long task**,
with the DOM growing from 1494 to **5233 elements** (3.5×). Opening the briefing issues
`daily_brief` × 1 **plus `sector_summary_preview` × 14** in every trial — confirmed by the
recorded `opDelta`, not inferred.

**Mechanism:** `src/Briefing.tsx:53-57` renders one `<SectorSummary>` per sector
unconditionally. Each mounts and immediately dispatches `sector_summary_preview` in its
mount effect (`src/SectorSummary.tsx:77-85`), even though the preview it fetches is only
displayed behind a collapsed "Review selected source inputs" `<details>` (and behind the
"Generate" button, which is `disabled` until the preview arrives — `SectorSummary.tsx:111`).
So 14 round trips, 14 state updates and 14 result subtrees are built for content the user has
not asked to see. On the native side this is worse than it looks: `sector_summary::select`
(`src-tauri/src/sector_summary.rs:243-254`) **re-runs the full `daily_brief` query for every
single sector**, plus `database.list("source")` and `database.article()` per item — so the
14 previews re-derive the whole briefing 14 times.

**Files:** `src/Briefing.tsx`, `src/SectorSummary.tsx`. Native side, if the fan-out is kept
but batched: `src-tauri/src/sector_summary.rs`, `src-tauri/src/lib.rs:285-289`.

**Direction, not a number:** render the sector's summary affordance first and fetch the
preview on first expand (or expose one batched `sector_previews` op that computes all sectors
from a single `daily_brief`). The claim being made is structural — 14 avoidable round trips
and a 3.5× DOM spike on every briefing open — **not** a speedup figure. No post-change
measurement exists, so no improvement is quantified here.

### 2. Replace the two whole-cache JSON fingerprints with structural sharing

**Measured:** `reconcileArticles` 31.4ms + `searchRevision` 21.7ms = **~53ms of main-thread
serialization per data change** at 5000 cached stories, which is the mechanism behind the
~90–180ms long tasks on tab switch, reader open and the no-op refresh cycles. The full
snapshot is **5,721,434 bytes** (5.7MB) per `snapshot` dispatch.

**Mechanism:** three places stringify the entire cache to derive a change token or an
identity check:

- `src/model.ts:45-52` `reconcileArticles` — `JSON.stringify(old) === JSON.stringify(article)`
  for **both** sides of every row, so 2×5000 stringifications per data change, purely to
  decide whether the object identity can be preserved.
- `src/App.tsx:451-454` `searchRevision` — a `useMemo` that rest-spreads every article and
  stringifies all of them, re-running on **every** `data.articles` change.
- `src/App.tsx:162-167` `briefingInput` — projects 17 fields from all 5000 articles and
  stringifies them on every load, only to feed a `key`/equality check.

`reconcileArticles` is the clearest win and the safest: the native layer already knows which
rows changed, and `App.tsx:168-190` already computes an id map on the same path. A per-row
cheap hash or an explicit `updatedAt`+revision comparison avoids serializing both objects.
`briefingInput` only needs to change when a briefing-relevant field changes, so hashing the
projected rows lazily (or versioning them natively) removes the per-load 8.8ms as well.

**Files:** `src/model.ts`, `src/App.tsx`. Native side, to supply a cheap change token
instead of a full re-read: `src-tauri/src/snapshot.rs` / `src-tauri/src/lib.rs`.

**Direction, not a number:** removing ~53ms of measured per-change serialization. The
replacement has its own cost, which was not measured, so no net saving is claimed.

## What could not be measured, and the limits of synthetic browser evidence

1. **No native numbers at all.** No Tauri window, no SQLite, no feed fetch, no AI provider.
   Every `dispatch` is answered in-page from memory. Native cost is absent from all timings
   above, and it is where the briefing fan-out is most expensive (14 re-derivations of
   `daily_brief`). **The 809ms briefing figure is a frontend-only lower bound.**
2. **The fan-out microbenchmark proves a negative.** Its 0.8ms result says the fixture is
   cheap, not that the app is fast. It is reported to prevent the misreading that "14
   dispatches cost 0.8ms, therefore this is fine".
3. **Fixture overhead is inside cold start.** The in-page fixture costs a median 56ms
   (1–28% of rows-ready) before any app code runs, so cold numbers are upper bounds.
4. **Local in-memory server, no network.** Transfer, latency and connection setup are absent;
   only main-thread work is measured. Real WebView2 asset loading differs.
5. **Headless Chromium, not WebView2.** Different engine build, scheduler and font stack.
   Absolute values are not directly transferable to the shipped desktop app.
6. **One machine, one cold-ish state.** Medians across 9 trials with a stated p25–p75 are
   reported, but no CPU pinning, no frequency locking and no warm/cold machine separation. The
   trial-1 outlier (7.8s) shows how much JIT and file-cache noise a single trial can carry.
7. **DOM element counts are layout-free.** `querySelectorAll("*").length` counts nodes, not
   layout, style recalc or paint cost. The 5233-node briefing spike is a proxy for work, not
   a measurement of it.
8. **No accessibility, memory, or frame-rate capture.** No INP, no layout-shift, no heap
   profile, no dropped-frame count, no screen-reader pass.
9. **The 100-row page cap is the app's, not the probe's.** Rows are page-bounded at 100
   (`App.tsx:533-536`); the 5.7MB cache lives in memory but only 100 rows mount. Results
   describe the shipped paging behaviour at 5000 cached stories.
10. **No before/after A/B was run.** Both recommendations are structural arguments backed by
    the measurements above. Neither has an implemented-and-remeasured counterpart, so no
    speedup is quantified for either.

## Evidence hygiene

The probe hashes the source files it exercises before and after the run and records
`changedDuringRun`; run2 reports `[]`, so the numbers above describe the code at git
`74c36cc` unmodified. Evidence files are write-once — the probe asserts the output path does
not already exist and stays inside the owned `docs/evidence/v05-performance-` prefix.

Earlier artefacts from this task's development, kept for traceability:
`v05-performance-smoke*.json` (8 incremental smoke runs, 7 of them failed runs) and
`v05-performance-run2-preclockfix.json` (a superseded 9-trial run containing the
clock-mixing bug described below). Neither is a valid baseline.

### Defects found and fixed in the probe during this task

- **`navigationToPaintedFrames` mixed two clocks.** It subtracted a page-relative
  `performance.now()` (returned by the rAF helper) from a driver-relative `wallStart`,
  producing large negative values (median −69,097ms). Now measured entirely on the driver
  clock and renamed from the misleading `navigationToTwoFrames`.
- **Cached-reload step had the same class of bug** in earlier runs (values from −6.3s to
  −43.6s in the superseded `run1`).
- Both are now guarded: every recorded duration is asserted finite and non-negative, so a
  clock mismatch fails the run loudly instead of quietly corrupting a median.
- **`fixtureInstallMs` was always 0** — the fixture start timestamp was not captured, so
  synthetic overhead was invisible inside cold start. Now measured (median 56ms) and
  reported separately.
- **`opDelta` on the cached-reload step** was labelled as a delta but was a whole-document
  total, because a reload rebuilds `window.__PERF__` from zero. Renamed
  `opCountsAfterReload`.
- **Port binding is now an explicit, labelled infrastructure failure.** A killed run left an
  orphaned process holding port 4183, and the retry surfaced only a bare EADDRINUSE stack.
  The probe now reports `INFRASTRUCTURE FAILURE: port N is already in use… No measurement was
  taken.` rather than a raw stack trace.

Note on the two aborted runs during this task: both were killed by the harness leaving an
orphaned Node process (one of which held port 4183), not by a TTY or stdio problem in the
probe. The probe spawns no interactive child and uses no npm/npx wrapper — `git rev-parse`
runs via `execFileSync` and was verified working. The real cause was port contention from the
orphans, which is what the new guard now reports explicitly.
