# Daily-use workflow and professional UI audit

Audited 2026-09-23 (Pacific), against the working tree at `a854054`, not a clean release snapshot. **Read-only application review; no application or test files changed.**

## Outcome

Keep the compact dark three-pane design. The highest-value work is to make existing reading operations trustworthy and fast, not add another dashboard, command palette, feed system, or AI feature.

**Six prioritized improvements: three P1, three P2. No P0 identified in this scoped audit.** Each finding below has an observed reproduction, precise implementation locations, and proposed acceptance tests. Acceptance tests are recommendations, not claims that fixes already pass.

### Before / after review

| Priority | Before | After | Why |
| --- | --- | --- | --- |
| 1 · P1 | A 5,000-story cache mounts 5,000 rows and recalculates related counts with full-cache scans inside each row. | Count groups once, isolate stable row rendering, then bound mounted rows if measurements still require it. | Routine keyboard reading takes over a second in the development fixture. |
| 2 · P1 | Under Unread, selecting a story removes it from the list; K can then move forward and mark another story read. | Navigate against a stable reading sequence, with an explicit cursor when the selected row leaves the filtered list. | The advertised previous-story command should not consume the next unread item. |
| 3 · P1 | The reading-pane X persistently hides a story, including a saved story, with no visible undo. | Separate close/back from a clearly named Hide action; provide profile-bound Undo using the existing article-state operation. | An ordinary close-looking affordance can make a saved item unreachable. |
| 4 · P2 | First-use empty cache, filtered-out saved items, and caught-up views mostly route to Manage sources. | Distinguish empty-cache, empty-collection, filtered-empty, caught-up, loading, and failed-refresh states; offer the matching next action. | The current copy sometimes states something false and sends readers to unrelated settings. |
| 5 · P2 | Yesterday's and last week's cached articles both show only `09:20 AM`. | Show day-aware row timestamps while retaining the exact timestamp on hover and in the reader. | A catch-up tool must expose freshness without opening every story. |
| 6 · P2 | Reading-pane width changes from 390 to 600 px, then returns to 390 after reload. | Persist validated, profile/window-scoped pane preferences while retaining responsive clamping. | A daily multi-monitor workspace should remember its reading setup. |

## Scope and evidence quality

- Read `graphify-out/GRAPH_REPORT.md` first, then queried `graphify-out/graph.json`. The graph JSON contains **3,057 nodes**; the report header still says 1,246. Used the graph for entry points, then checked live source rather than trusting stale counts.
- Read `PRODUCT.md`, `DESIGN.md`, the Impeccable product register, App, Settings, styles, model, IPC seam, pane component, and relevant existing browser tests.
- Ran independent Vite test-mode server on port 1438 with a temporary dependency cache; launched isolated Playwright Chromium contexts. Reused **existing `tests/e2e/fixture.ts`** in memory. Fixture updates touched browser-local test state only.
- Captured and visually inspected **19 screenshots**, all under `docs/evidence/daily-use-audit-*.png`.
- Exercised selection, Save, Saved navigation, Unread, J/K, Hide, refresh failure, Shortcuts/Escape, Daily briefing, pane resizing/reload, narrow list/reader transitions, and large-cache keyboard selection.
- No production database, feed connection, AI service, native window geometry, shared Ollama instance, or release build was touched. Native multi-monitor/DPI behavior and native persistence are **not** established by these browser observations.
- The sector-summary implementation was being edited by other workers. It was observed, not audited or modified; its screenshot is not a release certification. One HMR update occurred during the large-cache measurement batch. Timing results are diagnostic, not a production benchmark.
- Initial launch attempts used development mode and showed the expected desktop-runtime-required screen. Corrected to test mode without altering the IPC seam. Successful interaction batches had no application page errors. A contrast-probe canvas generated its own browser performance advisory, not an application defect.
- All audit-owned Vite processes were stopped; ports 1437 and 1438 both refused connections afterward. No competing build or full test suite was started.

## Existing features to preserve — do not duplicate

- **Daily briefing already exists:** dated, sector-organized cached coverage with explicit limits and optional AI. Combined sector summaries are already in active implementation. [Screenshot](evidence/daily-use-audit-briefing.png).
- **Your brief already exists:** `mode: "brief"` selects `firstSeen > previousVisit` in `src/model.ts:8–13`; App labels it "Since your previous visit". It is distinct from the calendar-day briefing.
- **Unread and Saved already work as filters and article state:** selecting marks read; the reader has Save/Unsave and Mark unread/read. Sidebar navigation deliberately clears Unread (`App.tsx:320–329`). This was verified: entering Saved from an unread view shows the saved read article. The false-empty finding below occurs when Unread is subsequently enabled **inside Saved**, not from filter leakage. [Successful Saved navigation](evidence/daily-use-audit-saved-unread.png).
- **Keyboard discovery is already strong:** visible Shortcuts button, `?`, `/` hint in search, J/K hint in the empty reader, full shortcut table, dialog Escape, and keyboard-operable pane separators. Do not propose a second shortcut overlay. [Shortcuts](evidence/daily-use-audit-shortcuts.png).
- **Stable arrivals already exist:** new stories wait behind "Show latest" instead of silently reordering the reading list. The large-cache probe used this existing affordance.
- **Multi-window controls already exist:** Screens, Detach, tab switching/reordering, and Reattach. This audit did not retest native monitor movement.
- **Source health, profiles, watchlists, provider configuration, backup, and public-discussion separation already exist.** Their discoverability should be improved in context rather than by adding duplicate navigation.

## 1. P1 — Remove quadratic work from routine reading

**Category:** Performance. **Files:** `src/App.tsx:428–440, 979–1023`, specifically the two `data.articles.filter(...)` calls at 1009–1014; existing `src/model.ts` if the count projection is factored out. Tests: extend `tests/e2e/keyboard-scroll.spec.ts` and `tests/model.test.ts`; a targeted `tests/e2e/daily-use-performance.spec.ts` is appropriate if separating the stress fixture.

**Observed:** At 1440×900, seeded cached articles in pairs sharing a group, using the existing fixture seam and "Show latest". For each size, dispatched J from `document.body` and measured elapsed browser time through two animation frames, three sequential samples. This includes frontend/fixture work, not network or Rust latency.

| Cached/mounted story rows | DOM elements | J-to-two-frame samples, ms | Median, ms |
| --- | ---: | --- | ---: |
| 100 | 1,250 | 46, 68, 22 | 46 |
| 1,000 | 10,250 | 89, 166, 164 | 164 |
| 5,000 | 50,250 | 1,495, 1,159, 1,272 | 1,272 |

[5,000-row screenshot](evidence/daily-use-audit-5000-rows.png). The screenshot shows a normal compact list, not 5,000 visually useful rows; DOM inspection confirms every row is mounted. With all 5,000 visible articles in multi-article groups, the current related-count expressions imply **50,000,000 predicate visits per full render**, before other work.

**Smallest fix:** Build a `Map<groupId, count>` once per article-array change; never perform full-cache filtering inside the row renderer. Extract a stable memoized row with primitive state/count props and stable selection callback. Profile again before introducing virtualization. If mounting remains dominant, use bounded rendering with explicit load-more or a small existing-style windowing implementation that preserves keyboard traversal; no new heavy table framework.

**Acceptance:**
1. Unit-test group counts with singleton, grouped, hidden, and filtered stories; preserve the product's existing meaning of related coverage.
2. With 5,000 fixtures, J/K, Save, and typing remain usable; repeat the same probe in an otherwise idle session. Target median under 200 ms, then verify the packaged native build separately.
3. Verify selection and scroll after 100 J presses, unread transitions, filtering, and accepting new arrivals. Optimizing must not reorder the stream or break offscreen keyboard selection.

## 2. P1 — Make Unread keyboard navigation directional

**Category:** Keyboard interaction / daily catch-up. **Files:** `src/App.tsx:439, 444–453, 514–525`; extend `tests/e2e/keyboard-scroll.spec.ts`, `tests/e2e/reader.spec.ts`.

**Reproduction:** With the first fixture story hidden, two unread stories remain: lunar observations, then battery chips. Enable Unread, focus outside fields, press J. The reader shows lunar observations and it is marked read, disappearing from `rows`. Press K. The reader now shows **battery chips**, and that story is also marked read. The list becomes empty. [Observed result](evidence/daily-use-audit-unread-keyboard.png).

**Cause:** `rows.findIndex(selectedId)` becomes `-1` after auto-read removes the selected row. Clamping both direction calculations to zero selects the first remaining unread row. Thus "previous" advances and changes read state.

**Smallest fix:** Preserve a stable navigation cursor/ordered ID sequence for the active reading session. When selected content no longer matches Unread, previous must return to the previously visited story or be a documented no-op at the beginning; it must not select the next unread story. Keep the selected excerpt visible. Do not turn off Unread silently or reinsert arbitrary newly fetched items.

**Acceptance:** With A/B/C unread, test J → A, J → B, K → A (or an explicitly chosen equivalent stable previous policy), and assert C remains unread. Repeat after mouse selection, Mark unread, Hide, filtered search, and a background refresh. Single-key shortcuts must remain disabled in fields/dialogs. Selection should remain in view without keyboard animation.

## 3. P1 — Make Hide distinguishable from close, and reversible

**Category:** Interaction safety / saved workflow. **Files:** `src/App.tsx:1064–1120, 1198–1212`, `src/model.ts:8–12`; potentially `src/styles.css` for a compact inline undo affordance. Tests: `tests/e2e/reader.spec.ts`, `tests/e2e/errors.spec.ts`, `tests/e2e/regressions.spec.ts`.

**Reproduction:** Select the lunar story, Save, open Saved stories, then click the reader's top-right X (`aria-label="Hide story"`). The saved list becomes empty. Readback remains `{id:"a", saved:true, hidden:true}`. There are **zero** visible Undo/unhide/restore-hidden buttons, and the frontend contains no corresponding unhide action. [After hiding](evidence/daily-use-audit-saved-hidden.png), [ambiguous reader X](evidence/daily-use-audit-desktop-reader.png).

**Impact:** This is not data deletion, but the saved item becomes inaccessible through ordinary article views. The same X symbol elsewhere means dismiss/close, making the persistent effect surprising to sighted users.

**Smallest fix:** Make X only clear selection (if a desktop close-reader control is wanted); expose a distinct labeled Hide action or a small overflow action. After successful hide, announce "Story hidden" with an explicit Undo button, calling the existing `article_state` request with `hidden:false`. Bind the undo target to the original profile/article; never mutate whichever profile happens to be current later. Retain the saved flag. Avoid confirmation modals for routine hiding when reliable undo is available.

**Acceptance:** Save → Hide → Undo restores the same article and saved state. Closing/back changes neither hidden nor saved. Failed Hide/Undo keeps recoverable UI and reports the error. Switching profiles while an undo notice exists cannot unhide a same-ID article in the wrong profile. At narrow widths the recovery control remains visible/reachable rather than living only in the footer span that CSS hides.

## 4. P2 — Replace generic empty/recovery copy with a small state matrix

**Category:** First-run understanding, consistent loading/error/empty states. **Files:** `src/App.tsx:455–470, 563–579, 730–740, 891–895, 940–942, 1024–1047`; use `src/model.ts` for a pure state classifier if helpful. Tests: extend `tests/e2e/first-load.spec.ts`, `tests/e2e/errors.spec.ts`, `tests/e2e/reader.spec.ts`.

**Observed states:**
- First-use-shaped fixture (`articles:[]`, `lastRefresh:null`, one enabled source): "No stories in this view", advice to refresh/adjust preferences, but primary empty action is **Manage sources**; refresh itself is a distant icon. [Screenshot](evidence/daily-use-audit-first-run-empty.png). This simulates the empty UI, not the native first-launch scheduler.
- Saved contains one read/saved story. Enable Unread inside Saved: "**No saved stories yet**" while the reader still shows the saved story and filled bookmark; action is Manage sources. [Screenshot](evidence/daily-use-audit-saved-filter-empty.png).
- Read the remaining unread stories: "No stories in this view" and Manage sources instead of a useful caught-up state.
- Injected refresh failure: raw "Error: Fixture service unavailable" with Dismiss, but no contextual Retry in the banner. [Screenshot](evidence/daily-use-audit-refresh-error.png). The existing refresh button remains available, so this is a recovery/discoverability improvement, not a total blocker.

**Smallest fix:** Derive state from the unfiltered collection, active filters, pending request, and last refresh. Suggested mapping: empty cache → **Refresh feeds** plus secondary Sources; saved collection truly empty → **Browse headlines** plus "Select a story and press S"; collection has items but filters exclude all → **Clear filters** and "No saved stories match these filters"; no unread items → **You're caught up / Show all stories**; failed refresh → **Retry refresh**, existing cached content retained. Suppress definitive empty claims while searching/loading. Explain the existing "Your brief" as "Since last visit" in navigation or supporting copy, without creating a second catch-up feature.

**Acceptance:** Table-driven browser cases for each branch, including no enabled sources, empty Saved, saved+read+Unread, content-type filter, query, delayed search, failed refresh with cache, and failed refresh without cache. The visible CTA must resolve the actual state in one action. Keep native initial-load Retry, existing semantic status/alert roles, and privacy/source limitations.

## 5. P2 — Expose publication day in cached-list timestamps

**Category:** Information hierarchy / daily catch-up. **Files:** `src/App.tsx:992–998`, `src/model.ts:33–36`; tests `tests/dates.test.ts`, `tests/e2e/reader.spec.ts`.

**Reproduction:** Set the fixture publication timestamps to September 23, 22, and 16 at 09:20. Browser readback:

```text
09:20 AM — title: 9/23/2026, 9:20:00 AM
09:20 AM — title: 9/22/2026, 9:20:00 AM
09:20 AM — title: 9/16/2026, 9:20:00 AM
```

[Identical visible times](evidence/daily-use-audit-dates.png). Exact dates are already available on hover and in the reader; do not duplicate that functionality instead of fixing the list.

**Smallest fix:** A locale-aware compact formatter: time for today, "Yesterday" plus time where width permits, date for older items; include year when needed. Keep exact local time in `title` and a semantic `dateTime`; preserve Undated. Do not replace publication time with retrieval time.

**Acceptance:** Freeze clock/timezone and test today, yesterday, previous year, future timestamps, null, and daylight-saving boundaries. At 390/640/1024 widths, metadata must not push publisher/title outside the row. Save a week-old story and confirm its age is clear directly in Saved.

## 6. P2 — Remember pane widths without defeating responsive layout

**Category:** Workspace continuity / multi-monitor usability. **Files:** `src/App.tsx:59–60, 750–754, 878–885, 1052–1060`, `src/PaneDivider.tsx`, `src/styles.css:1033–1069`; extend `tests/e2e/panes.spec.ts` and native workspace verification when implemented.

**Reproduction:** Focus "Reading pane width", press End. Both `aria-valuenow` and measured detail width become **600**. Reload the same fixture workspace: both return to **390**. Selected article survives, but the user's split does not. [600 px](evidence/daily-use-audit-pane-600.png), [reset](evidence/daily-use-audit-pane-reset.png). App initializes widths with plain `useState` constants.

**Smallest fix:** Persist a tiny validated UI-layout preference after committed resize, keyed by profile and stable window/tab identity. Use the existing persistence conventions or non-sensitive local UI storage; do not introduce a layout framework or backend service merely for two numbers. Clamp restored values to current viewport constraints, and keep the user's preferred value distinct from its temporarily clamped rendered width. Handle malformed/unavailable storage safely. Avoid writes on every pointer move.

**Acceptance:** Resize → reload restores the preference; change profile/window → layouts remain independent; 1440 → 640 → 1440 preserves the preference while the narrow list/detail switch still works. Keyboard Home/End/arrows and pointer dragging produce equivalent saved results. Restart the native executable in isolated appdata and test detached-window restoration before claiming native persistence.

## Professional quality and responsive checks

**Anti-pattern verdict: pass.** This is a restrained product interface, not a marketing template: aligned rows, real source metadata, system typography, no decorative charts/animation, clear cached-versus-original distinctions. Keep that identity.

Heuristic scores, not a WCAG certification or exhaustive audit:

| Dimension | Score / 4 | Evidence |
| --- | ---: | --- |
| Accessibility | 3 | Named controls, focus rings, keyboard help and pane controls; unread direction bug remains. Sampled text contrast passes AA, not a complete contrast audit. |
| Performance | 1 | Severe large-cache scaling in actual interaction probe. |
| Responsive | 3 | Structural sidebar/pane collapse works at tested sizes; compact icon targets are below touch-comfort recommendations. Native 200% scaling remains untested here. |
| Theming | 3 | Consistent dark semantic tokens and hierarchy; no theme redesign needed. |
| Anti-patterns | 4 | Product-appropriate density and no decorative dashboard scaffolding. |
| **Total** | **14 / 20** | **Good visual foundation; fix the workflow/performance weaknesses.** |

- At **1440×900, 1024×768, 640×720, 390×844**, measured body scroll width equals viewport width. Inspected list/reader images show no horizontal clipping in those states. At 640, Back to headlines correctly restores the list.
- At **720×450**, the Shortcuts dialog measures `{x:16,y:30,width:688,height:390}` and fits the viewport, with scrollable content. This is a short/narrow reflow check, **not a real native 200% zoom test**.
- Browser title is `News Terminal`; HTML language is `en`.
- Computed CSS colors rasterized to sRGB for contrast: selected read headline **8.72:1**, selected-row metadata **6.19:1**, reader fine print **7.63:1**. No sampled contrast failure; do not brighten the whole palette gratuitously.
- At 390 px, ten visible icon-sized controls had both dimensions below 44 px (mostly 30×30; menu 30×36). This is a mouse-first Windows app, so this observation is **not** treated as an automatic WCAG AA failure or a seventh redesign priority. If touch is an explicit target later, scope larger coarse-pointer hit areas rather than globally reducing information density.

## Evidence index

All 19 files were captured from the actual rendered app using labeled fixture state and visually inspected:

- Baseline: [desktop-start](evidence/daily-use-audit-desktop-start.png), [desktop-reader](evidence/daily-use-audit-desktop-reader.png), [shortcuts](evidence/daily-use-audit-shortcuts.png), [briefing](evidence/daily-use-audit-briefing.png).
- Saved/unread: [saved-unread — successful filter reset](evidence/daily-use-audit-saved-unread.png), [saved-filter-empty](evidence/daily-use-audit-saved-filter-empty.png), [saved-hidden](evidence/daily-use-audit-saved-hidden.png), [unread-keyboard](evidence/daily-use-audit-unread-keyboard.png).
- Recovery: [first-run-empty](evidence/daily-use-audit-first-run-empty.png), [refresh-error](evidence/daily-use-audit-refresh-error.png).
- Responsive: [1024-reader](evidence/daily-use-audit-1024-reader.png), [640-reader](evidence/daily-use-audit-640-reader.png), [640-list](evidence/daily-use-audit-640-list.png), [390-list](evidence/daily-use-audit-390-list.png), [720x450-shortcuts](evidence/daily-use-audit-720x450-shortcuts.png).
- Other reproductions: [dates](evidence/daily-use-audit-dates.png), [5000-rows](evidence/daily-use-audit-5000-rows.png), [pane-600](evidence/daily-use-audit-pane-600.png), [pane-reset](evidence/daily-use-audit-pane-reset.png).

## Handoff

Suggested sequence: optimize list hot path; fix unread cursor and safe Hide; implement contextual state copy/actions; finish timestamp and layout continuity. Changes should remain small and reuse current state/IPC rather than add dependencies. Coordinate with the sector-summary owners before touching shared App/types/styles/tests. Finish with Impeccable polish, then repeat this audit's interaction cases and native isolated-appdata checks.

Application source and fixtures remain read-only from this audit. Only this report and the prefixed screenshots were created in the repository. The referenced `.Codex/rules/common/research-capture.md` was absent; an available equivalent at `Desktop/claude-harness-config/rules/common/research-capture.md` explicitly assigns subagent-report publication to the commander. Parent should perform any required Mission Control capture on receipt; this subagent did not post externally.
