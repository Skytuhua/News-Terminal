# News Terminal 0.5 daily-use feature proposal

**Status: proposal only; no approval implied. Application, tests, scripts, versions and release artifacts were read-only. This task owns only this document.**

Method: read `graphify-out/graph.json` (6,744 nodes / 21,857 links) first, then `PRODUCT.md`, `DESIGN.md`, `docs/v04-guide.md`, `docs/v02-guide.md`, `docs/v04-daily-use-proposal.md`, `docs/daily-use-audit.md`, `docs/IPC-CONTRACT.md` and current `src/**` + `src-tauri/src/**`. Every claim below is cited to current source. Nothing here re-proposes what 0.4 already shipped (hidden recovery, saved/unread, pagination, full-cache search, day-aware dates, per-scope pane widths, tabs/detach, media, briefing, quotations, HN stream, source health, quiet hours, Ollama, import/export, local SQLite).

**Carried-over deferred item:** the 0.4 proposal's addition 2, a Read-only status filter (`docs/v04-daily-use-proposal.md:86–94`), is still unimplemented — `docs/v04-guide.md` documents only hidden recovery, source health, performance, backup and privacy, and `src/App.tsx:1106–1131` still exposes exactly two controls (content type, Unread). It survives as candidate 3 below.

---

## Ranked top 5 by daily value

### 1. Bulk triage on the headline list (mark read/unread, hide, save) — highest daily value

**User problem.** The single most frequent action in a catch-up session is clearing a backlog, and it is one article per click. `select()` marks a single article read (`src/App.tsx:555–565`), `hideStory()` handles exactly one target (`src/App.tsx:570–588`), and `article_state` is structurally single-article: it validates one `articleId` and writes one `states` row (`src-tauri/src/db.rs:1363–1389`). `HeadlineRow` renders no selection affordance at all (`src/HeadlineRow.tsx:11–26`), and the list has no multi-select. A reader returning after two days faces dozens of unread rows and must click or press S thirty times. Worse, each action round-trips: `action()` awaits the write and then forces a full workspace reload (`src/App.tsx:298–316`, reload at `:307`), so even a hand-rolled renderer loop would cost N writes plus N snapshot reads. Hide is the sharpest case — hiding N stories is N sequential confirmed writes with a single transient Undo target (`src/App.tsx:92`, `:589–603`).

**Exact scope.**

1. Add selection state to the list, not a new surface: click on the row's left gutter toggles selection; `Shift`+click and a "Select all on this page" action extend it. Selection is scoped to the currently mounted 100-row page (`pageSize` at `src/App.tsx:533`), to the active profile, and to the current filter set. It is never persisted to the workspace and never survives a tab switch (`src/App.tsx:380–386`).
2. One new host operation `article_state_many {profileId, replacementToken, items:[{articleId, read?, saved?, hidden?}]}` in the `article_state` arm (`src-tauri/src/db.rs:1363–1389`). Reuse `boolean()` validation, `require_replacement`, `require_profile` and the existing 10,000-saved cap (`:1369–1377`) exactly as the single path does. Cap the batch (e.g. 200 ids) and reject unknown ids with the existing `"Unknown article"` error rather than partially succeeding.
3. Apply keys per item in the documented order `read`, `saved`, `hidden` so a multi-key item behaves identically to the single path. Preserve `groupId` and unrelated keys exactly as `state()` already does.
4. Renderer-only actions on top of it: **Mark read**, **Mark unread**, **Hide**, **Save/Unsave**, plus **Invert**. Hide selection uses the existing `hiddenUndo` banner semantics but must say how many stories were hidden, and must not pretend N independent Undo targets exist.
5. Keyboard: `X` hides the selection (single-story `X` hides the selected story, matching the detail toolbar's existing Hide at `src/App.tsx:1249`). `M` toggles read on the selection. Both must respect the existing guards — no-op while typing in a field, with a dialog open, or during a workspace swap (`src/App.tsx:625–638`).
6. Nothing in this slice marks read as a side effect of selecting, changes `filterArticles` (`src/model.ts:12–44`), changes the 100-row page size, or alters Hidden/Saved semantics.

**Acceptance criteria.**

- Select 3 rows → Hide → all three leave the list, one confirmation read shows `hidden:true` for all three, and the single banner names the count.
- Send `{read:true}` for a mixed selection; read the state back per article and assert each row is `read:true` and that `saved`/`hidden`/`groupId` are unchanged for rows where only `read` was sent.
- A batch containing one unknown `articleId` is rejected whole; assert no partial write by reading every article in the batch.
- A stale `replacementToken` is rejected and the UI reports it as a rejected action, not as a silent no-op (mirror the replacement discipline at `src/App.tsx:298–316`).
- Per-profile isolation: same article ID selected in profile A, batch sent while profile B is active, must be rejected — never applied to B.
- Selection is cleared on profile switch, tab switch, import, filter change and page change; assert no stale selection survives a background `data-changed` reload.
- Browser fixture proves the operation fires **once** for a 5-row action, not five times.
- Keyboard-only: `X` and `M` work with no mouse; they do nothing while the search input has focus.
- A hidden selection is still recoverable through the shipped Hidden stories view; the slice must not weaken it.

**Files.** Production: `src/App.tsx`, `src/HeadlineRow.tsx`, `src/daily-use.css` (selection styling only), `src/types.ts` (request shape if it is not inline), `src-tauri/src/db.rs`. Tests: `src-tauri/tests/backend.rs`, `src-tauri/tests/backend_limits.rs` (batch bound), `tests/e2e/daily-reading.spec.ts`, `tests/e2e/keyboard-scroll.spec.ts`, `tests/e2e/reader.spec.ts`, `tests/e2e/fixture.ts` (one `article_state_many` branch), `tests/e2e/daily-recovery.spec.ts` (hide-selection vs Undo). Docs after delivery: `docs/IPC-CONTRACT.md` mutations list. No version, script or release change.

**Host/IPPC:** host change required — one new validated write operation.

**Risk.** Medium. The dangerous failure is a batch that partially applies and then reports failure, which would desynchronise renderer belief from stored state. Secondary risks: selection surviving an import (mitigated by the existing `recoveryEpoch`/`workspaceGeneration` discipline at `src/App.tsx:124–129`, `:228–253`), the saved-count cap firing mid-batch, and `X` colliding with a future shortcut. The count-honest Hide banner is a wording obligation, not a nicety.

**Effort.** 1.5–2.5 focused engineering days including tests. The host operation is small; the selection model, focus/keyboard behavior and the four race cases are the real cost. Estimate, not a measurement.

---

### 2. Unread counts in navigation

**User problem.** On opening the app there is no way to see where unread material is. Every sidebar destination renders a bare label with no count (`src/App.tsx:943–1050`), and the only count the app computes is related-coverage per `groupId` (`src/App.tsx:512` → `src/model.ts:53–56`). The status bar reports enabled source count and refresh time, not reading state (`src/App.tsx:1329–1345`). A reader with unread items in Technology, in Saved, and in a watchlist has to visit each destination to discover that, which is exactly the trip counts would remove.

**Exact scope.**

1. Render a count on All headlines, Your brief, Saved stories, Hidden stories, each Focus section, and each watchlist. Use the same `filterArticles` + read predicate the list itself uses (`src/model.ts:12–44`, unread row filter at `src/App.tsx:525`) so a badge can never disagree with what the destination shows.
2. Count unread only. Do not show total counts, and do not show a count on a destination whose visible rows are zero.
3. Counts reflect the current accepted snapshot including the stable old-saved overflow that `snapshot` already returns (`src-tauri/src/db.rs:1202–1203`, `:614`). Do not widen the snapshot to compute them.
4. Non-color-only: a numeric label with an accessible name such as "12 unread". Zero counts render nothing, not "0".
5. Counts recompute from the same memo the rows use, so a background `data-changed` reload cannot leave a stale badge. Never reorder or move the visible stream to satisfy a count.

**Acceptance criteria.**

- Each destination's badge equals the unread row count observed after navigating to it, for a fixture covering read/unread/saved/hidden mixes.
- Badge disappears when the destination reaches zero unread; a hidden story is excluded, matching `!a.hidden` in `src/model.ts:26`.
- Watchlist badges use the watchlist's own dimension matching, including the all-dimensions-must-match rule (`src/model.ts:31–42`).
- After marking stories read from the list, the badge updates without a manual reload and without reordering rows.
- 200% zoom and 390 px width: counts remain readable and never push a nav label out of its row.
- Screen-reader names are asserted; the number is not conveyed by a colored dot alone.

**Files.** Production: `src/App.tsx`, `src/model.ts` (a pure, unit-tested count projection), `src/daily-use.css`. Tests: `tests/model.test.ts`, `tests/e2e/daily-empty.spec.ts`, `tests/e2e/daily-layout.spec.ts`, `tests/e2e/focus-navigation.spec.ts`.

**Host/IPC:** renderer-only. All required data is already in `Snapshot`.

**Risk.** Low. The one real hazard is a badge that disagrees with its destination, which is a trust failure; deriving both from one projection removes it. Watch out for the existing audit's warning about quadratic work — `relatedCounts` is a single `Map` pass (`src/model.ts:53–56`) and counts must be built the same way, never by filtering inside render.

**Effort.** 0.5 day including tests. Mostly memo wiring and copy.

---

### 3. Reading status selector: All / Unread / Read (the surviving 0.4 deferred item)

**User problem.** The list offers All types plus an Unread checkbox (`src/App.tsx:1106–1131`) and nothing else. There is no way to answer "I already read this — show me what I haven't", or "show me what I've already read in this view". `Article.read` is a plain boolean in state (`src/types.ts:119`, written at `src-tauri/src/db.rs:1378–1383`), so this needs no new data.

**Exact scope.**

1. Replace the Unread checkbox with a native select labelled **Reading status**: All / Unread / Read. Apply it after collection and content filters, alongside the existing kind filter, using the current row pipeline (`src/App.tsx:516–525`).
2. Default and reset value is All. Selection is view-local like `kind` and `unread` today (`:107`, `:106`) and resets on tab/profile/filter change exactly as those do (`:380–386`, `:538`).
3. Label the option **Read**. Never "Recently read" — there is no read timestamp, and `Article.history` is publisher revision history, not reading history (`src/types.ts:125`, populated during ingestion at `src-tauri/src/db.rs:403–413`).
4. Changing the selector must not write article state. Unread semantics and the existing J/K stable-sequence behavior (`src/App.tsx:528–532`) are unchanged.
5. The filtered-empty state must offer a reset that clears status as well as query, kind and topic (`src/App.tsx:1180–1183`, `src/EmptyHeadlines.tsx:17–21`).
6. No timestamps, no activity log, no Clear history, no analytics, no retention change.

**Acceptance criteria.**

- Read shows only visible `read:true` stories in All, Saved, Your brief and each watchlist; Unread and All behave exactly as today.
- Changing the selector issues zero `article_state` writes.
- Mark unread from the detail toolbar (`src/App.tsx:1236–1248`) removes the row from a Read view while leaving the reader usable and J/K stable.
- Filtered-empty with status=Read offers **Clear filters** and the reset restores All.
- Pagination and search remain reachable; rows beyond the 100-row page are still counted in the status text (`src/App.tsx:1128–1130`).
- Existing `tests/filter.test.ts` and the reader/keyboard specs that locate the Unread checkbox are updated deliberately, not mechanically.

**Files.** Production: `src/App.tsx`, `src/EmptyHeadlines.tsx`, `src/model.ts` (pure predicate). Tests: `tests/filter.test.ts`, `tests/model.test.ts`, `tests/e2e/reader.spec.ts`, `tests/e2e/daily-empty.spec.ts`, `tests/e2e/keyboard-scroll.spec.ts`, `tests/e2e/fixture.ts` if the fixture keys off the control.

**Host/IPC:** renderer-only.

**Risk.** Low, with one honest caveat already recorded in 0.4: Read is a current boolean, not proof of opening time, of full reading, or of visiting the publisher. The label must not overclaim. Changing a control that shortcut and empty-state tests locate is mechanical churn, not risk.

**Effort.** 0.5 day including test updates. Smallest item on this list.

---

### 4. Source list: search, filter, and remove a custom source

**User problem.** Sources & health renders every source in one long scrolling list with no search box, no filter and no sort (`src/Settings.tsx:569–648`). With the reviewed catalog plus custom feeds, finding the one failing feed means scrolling. Worse, a custom feed can be **disabled but never removed**: `source_update` accepts only `enabled` or `mediaAllowed` and explicitly errors otherwise — `"Source update requires enabled or mediaAllowed"` (`src-tauri/src/db.rs:1327–1331`) — and no `source_delete` operation exists anywhere in `src-tauri/src`. Connections inherits the same dead end: its duplicate-URL message sends you to "Sources & health" to manage a source you cannot remove (`src/Connections.tsx:52`). `refreshMinutes` is stored and honored by the scheduler (`src-tauri/src/db.rs:974–987`) but is hardcoded to 30 on add (`:1308`) and is not editable anywhere in the UI. A feed you added by mistake is permanent clutter that still occupies a full health card forever.

**Exact scope.**

1. Add a local search field and a status filter to the existing Sources & health panel: All / Failing / Disabled / Never succeeded. Search matches name, publisher and feed URL. Purely a view over the data already in `Snapshot.sources`; no new host data.
2. Add **Remove** for custom (non-catalog) sources only, behind the existing two-step confirm pattern used for watchlists (`src/Settings.tsx:356–386`). Bundled catalog sources keep enable/disable only; say so in the copy rather than showing a disabled button.
3. New host operation `source_delete {sourceId}` that removes the source document and any watchlist references to it, but **does not delete cached articles**. Cached stories from a removed source must keep rendering with their stored `sourceName` — the name is denormalized into the article payload at `src-tauri/src/db.rs:414`, so this is safe. Say plainly in the confirm copy that cached stories are kept and that removing a source is not required to stop fetching.
4. Do not add `refreshMinutes` editing in this slice. It is a separate scheduler-facing decision and the eligibility copy in `src/Settings.tsx:611` already explains the interval honestly.
5. No automatic re-enabling, no source reordering, no per-source article counts (that needs a new aggregate), no bulk import.

**Acceptance criteria.**

- Search narrows the rendered rows and the count reflects the filter; clearing restores every row.
- Failing filter uses the same predicate as the existing sidebar badge (`sourceFailed`, `src/model.ts:2`; used at `src/App.tsx:1056`) so the two cannot disagree.
- Disabled sources never appear in Failing; never-succeeded is a distinct state from failed-after-success (the distinction the panel already draws at `src/Settings.tsx:603`).
- Removing a custom source: the source disappears, its cached stories remain readable with their original publisher name, `Snapshot.sources` no longer contains it, and no watchlist retains a dangling source reference.
- Attempting to remove a bundled catalog source is refused by the host with a clear message, not by a hidden button.
- A source that is mid-refresh is not corrupted; `SourcePolicy` generation checks (`src-tauri/src/lib.rs:811–826`) must not leave a scheduled job writing a removed source.
- Backup round-trip: export → import preserves the removal and does not resurrect the source. Validate against `src-tauri/src/db/backup.rs:124`.

**Files.** Production: `src/Settings.tsx`, `src/Connections.tsx` (update the dead-end message), `src-tauri/src/db.rs`, `docs/IPC-CONTRACT.md` after delivery. Tests: `src-tauri/tests/backend.rs`, `src-tauri/tests/import_isolation.rs`, `tests/e2e/sources.spec.ts`, `tests/e2e/source-health.spec.ts`, `tests/e2e/v02-connections.spec.ts`.

**Host/IPC:** host change required — `source_delete`, plus watchlist reference cleanup.

**Risk.** Medium-high, and higher than its daily value justifies on a first slice. The live risks are removal racing an in-flight refresh and a dangling watchlist source reference; both are preventable but both are real. Scope reduction is legitimate: ship the **search + filter** half (renderer-only, near-zero risk) as its own increment and treat removal as a separate, host-reviewed change.

**Effort.** Search/filter half: 0.5 day. Removal half: 1–1.5 days plus native acceptance. Total 1.5–2 days.

---

### 5. Briefing → reader handoff (act on a story without leaving the day's coverage)

**User problem.** The daily briefing is the natural morning surface, and it is a dead end. Each item's only action opens the external URL in a browser (`src/Briefing.tsx:58–62`), and `BriefItem` does not even carry read/saved state (`src/types.ts:168`), so a story read in the briefing is still unread everywhere else and cannot be saved from there. The reader pane is not rendered in briefing view at all (`src/App.tsx:515`, `:1074`), so there is no way to select a briefing story into the reader. The result: you read the briefing, notice something, and must remember the title, switch to a headline tab, and search for it.

**Exact scope.**

1. Carry `read` and `saved` on briefing items. The values are already available: `daily_brief` reads through `read_articles`, which overlays `read`, `saved`, `hidden` and `groupId` from profile state (`src-tauri/src/db.rs:626–629`, `:644–648`), and `sector()` simply omits them from the projected item (`src-tauri/src/briefing.rs:174–184`). Adding two keys to that projection is a host change with no query, schema or ranking impact.
2. Per briefing item, add **Save/Unsave** and **Mark read/unread** using the existing `article_state` operation — no new write path. Do not open the reader, fetch media or invoke AI from the briefing; the sector quotation rules (`src/SectorSummary.tsx:96`) and per-story AI disclosure (`src/Briefing.tsx:63–67`) are unchanged.
3. Add **Open in headlines** for items the reader wants to read properly. This navigates to an All-headlines tab and selects the article.
4. Handle the honest failure case: briefing items come from `day_articles`, which queries the articles table directly and is **not** bounded by the newest-5,000 snapshot window (`src-tauri/src/db.rs:618–630` vs `:614`), while selection intersects with the accepted snapshot (`src/App.tsx:513`, `:519`). A briefing story outside the accepted window cannot be selected. When that happens, say so and offer the original link — do not silently do nothing and do not widen the snapshot to make it work.
5. Reflect the new state in the sector story counts honestly. Sector `articleCount` is original articles before conservative grouping (`src-tauri/src/briefing.rs:204`, coverage label at `:294`) — do not silently redefine it as an unread count.

**Acceptance criteria.**

- Save from a briefing item writes `{saved:true}` for that profile and article; reloading the briefing shows it saved; Saved stories lists it.
- Mark read from the briefing removes it from an Unread-filtered headline view and updates the item's own state.
- Briefing items show read/saved state that agrees with the headline list for the same article.
- **Open in headlines** selects the story when it is within the accepted snapshot; when it is not, the UI states that the cached headline list does not currently include it and offers the original link. Both branches are tested.
- No reader pane, media load or AI request is triggered by Save/Mark read in the briefing.
- Briefing for a date with no coverage still shows the existing honest empty state (`src/Briefing.tsx:68`); counts and the coverage label text are unchanged.
- AI permission rules are untouched: items without `aiAllowed` still expose no summary (`src/Briefing.tsx:65–66`).

**Files.** Production: `src-tauri/src/briefing.rs` (item projection), `src/types.ts` (`BriefItem`), `src/Briefing.tsx`, `src/App.tsx` (navigation handoff), `src/daily-use.css`. Tests: `src-tauri/tests/briefing.rs`, `src-tauri/tests/briefing_calendar.rs`, `tests/e2e/v02-briefing.spec.ts`, `tests/e2e/fixture.ts`, `tests/e2e/daily-reading.spec.ts`.

**Host/IPC:** small host change (item projection only) plus renderer work. No new operation, no schema change.

**Risk.** Medium. The snapshot-window mismatch in item 4 is the one that will actually bite, and it is a pre-existing architectural boundary — the fix is honest copy, not a snapshot change. Secondary risk: making the briefing stateful enough that it drifts from the headline list; deriving both from the same `article_state` path is the mitigation.

**Effort.** 1–1.5 days including tests. The host edit is two keys; the handoff branch logic and its two test cases are the cost.

---

## Verified gaps that did not make the top 5

Recorded so the next pass does not re-derive them, with the same citation standard.

**Follow-ups and alerts are invisible after the fact.** Watchlist alerts are the only notification path, and they are gated on a watchlist with `alerts:true` (`src-tauri/src/db.rs:781–793`) plus profile `alertsEnabled` and quiet hours (`:757–760`). Delivery writes a durable receipt to `alert_log` (`:804–807`, retained 90 days at `:823`) and fires a Windows toast (`src-tauri/src/lib.rs:937–952`) — but **no operation anywhere returns `alert_log` to the UI**, and no component in `src/**` reads it. Separately, the host emits a `notification-status` event when delivery fails (`src/lib.rs:953–956`) and **nothing in the renderer subscribes to it**: `src/ipc.ts:25–38` wires only `database-replaced` and `data-changed`, and the sole other `listen` in the app is `media-policy-changed` (`src/MediaSession.tsx:29`). A repo-wide search for `notification-status` returns exactly one hit, the emit itself. So a silently failing alert channel is currently undetectable in-app, and there is no way to review what you missed while away. Both halves are worth fixing; this ranks below the top 5 only because it matters to watchlist users rather than to everyone, every day. The subscription half is small and arguably a defect fix rather than a feature.

**Offline retention is invisible and lossy.** Retention deletes any article not saved in any profile that is older than 30 days or outside the newest 5,000 (`src-tauri/src/db.rs:821`). Saved articles are protected, and the Hidden stories view already explains the limit honestly (`src/HiddenStories.tsx:85`). Nothing surfaces cache age, size, or the fact that an unsaved story you half-remembered was pruned — and a search miss is indistinguishable from a pruned story. A small honest **Cache** disclosure (article count, oldest retained date, saved-protected count) in Preferences or the status bar would close most of this. Renderer-plus-one-aggregate, roughly half a day. A user-configurable retention window is a different and much larger decision and is not proposed.

**Compare/contrast is a detail-pane modal only.** `Coverage` renders related reports from `groupId` and a side-by-side dialog (`src/Coverage.tsx:45–61`, `:95–155`), reachable only from a selected story's reading pane. There is no way to compare a chosen set of stories, and no way to compare across sources that were never grouped. The existing disclosure copy is good and must be preserved verbatim in any extension — grouped-by-similarity must never read as verified agreement (`PRODUCT.md:16`). Low daily frequency for most readers; that is why it is here.

**Density has one axis and it is about images.** The list row is fixed at `padding: 15px 22px 13px` (`src/styles.css:393–400`). The only density control is Visual/Compact (`src/MediaSession.tsx:52–55`), which governs thumbnails, not row height (`src/StoryThumbnail.tsx:46`). A compact row mode is a genuinely cheap, renderer+CSS change for someone scanning a 100-row page, but it is a preference, not a capability.

**Keyboard coverage has real holes.** The handler at `src/App.tsx:624–699` and the help table at `src/Settings.tsx:983–1004` agree on `/`, Ctrl+K, J/K, O, S, R, Ctrl+T/W/Tab, `?`, Escape-for-dialogs. Missing and daily-useful: **hide a story without a mouse** (X, folded into candidate 1), **mark unread** (M, same slice), **Escape to close the reading pane** — Escape currently only reaches dialogs, so closing a story needs the back button at `src/App.tsx:1210–1215`. Roughly half a day for the three additions plus help-table sync; treat as part of candidate 1 rather than a separate feature.

**Discovery has no starting point beyond sections and watchlists.** Focus sections (`src/model.ts:104–109`) and topic lists (`src/App.tsx:972–980`) are the whole discovery surface; the AI section additionally carries Models and Benchmarks views (`src/App.tsx:1138–1146`) that are reference tables rather than news discovery. Nothing here is broken — this is a note that discovery breadth is a content decision (which sources, which topics), not a UI decision, and the constraints in `docs/source-policy.md` and `PRODUCT.md:10` are the real limit.

---

## Explicitly rejected

### R1. Free-form AI synthesis — an auto-generated morning digest

Tempting because it is the obvious "make the briefing smarter" move and the machinery is already in place. Rejected on settled, documented grounds. 0.4 deliberately ships **AI-selected source quotations** and explicitly refuses free-form synthesis (`docs/v04-guide.md:39`; `docs/v04-daily-use-proposal.md:5`). The renderer enforces that boundary, not just the copy: `SectorSummary` fails closed unless every bullet's text is byte-identical to a cited source quote (`src/SectorSummary.tsx:42–48`) and states the rule in-product (`:96`). The host validates quotations against bounded prompt inputs as well. `PRODUCT.md:16` forbids implying that related headlines establish verified agreement, and `docs/v02-guide.md:7` already warns that model output can be wrong on date comparisons observed during testing. Reopening this would trade a verified, cited, checkable artifact for prose that looks authoritative and is not — a net loss in a product whose stated purpose is to remain useful when AI providers fail. Effort would be small; value is negative.

### R2. A home dashboard — trends, source-share meters, sentiment, "most read"

Tempting because "professional" often gets read as "dashboard", and the data is right there. Rejected twice over. First, it is explicitly anti-referenced: no decorative chart, no invented sentiment or bias meter, no card-grid dashboard (`PRODUCT.md:16`), and rows-not-cards for headlines (`DESIGN.md:16`); the 0.3 daily-use audit passed the app on exactly this criterion (`docs/daily-use-audit.md:132`). Second, and decisively, the data does not exist. The `states` table holds only `read`, `saved`, `hidden` and `groupId` per profile and article (`src-tauri/migrations/001_initial.sql`; written at `src-tauri/src/db.rs:1378–1387`); there is no read timestamp, no open event, no dwell, no click-through record — which is the same finding that caused 0.4 to defer a chronological reading history (`docs/v04-daily-use-proposal.md:32`). Any trend or "most read" chart built today would be fabricated from a boolean, and a source-share meter would be a diversity-cap restatement that `PRODUCT.md:16` already rules out. The honest version of this need is a "what is new since my last visit" list, and **Your brief already is that** (`src/model.ts:28`, `src/App.tsx:999–1005`).

---

## Sequencing recommendation

Approve **one** item. Recommended order: **1 (bulk triage)** — it is the highest-frequency daily action and its absence is felt within seconds of opening the app on any day you did not read. **2 (unread counts)** is the cheapest possible orientation win and is a natural companion to 1. **3 (reading status)** is the surviving 0.4 deferral and is nearly free. **4** should be split, with search/filter shipped first and source removal deferred to host review. **5** is the most interesting but touches the briefing's honest coverage accounting, so it deserves its own increment.

Explicitly **not** in scope for any of the above: a chronological reading history or any `readAt` capture, free-form AI synthesis, new dependencies, retention-policy changes, new source defaults, schema migrations, version bumps or release-artifact edits.

## Validation boundary

This proposal did not run the application, execute tests, launch a build, or touch user data, configuration, `src/**`, `tests/**`, `scripts/**`, `package.json` or `release/**`. Every claim is a citation to current source at commit `74c36c`. Effort figures are engineering estimates, not measurements. Native behavior — notification delivery, multi-window, geometry, packaged executable — is not established by anything in this document and would need isolated-appdata acceptance before delivery, as `docs/v04-guide.md:41–43` requires.
