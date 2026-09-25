# News Terminal 0.4 daily-use proposal

**Status: proposal only; approval required before implementation.** Application, tests, user data and app configuration were read-only. This task owns only this document.

**Recommendation:** implement durable **Hidden stories recovery** first. Follow with a small **Read status filter**, then **actionable source-health feedback**. Do not build a chronological reading-history subsystem in this increment.

**Architecture:** retain React/Tauri/SQLite and existing article-state writes. Add one narrowly scoped read operation for retained hidden stories and one inline recovery view. No dependency, database migration, retention-policy change, ranking rewrite or new service.

## Findings grounded in current 0.3 source

Read `graphify-out/graph.json` before inspecting source, then `PRODUCT.md`, `DESIGN.md`, `docs/v03-guide.md`, `docs/daily-use-audit.md` and `docs/daily-use-review.md`. Historical reviews are not the current defect list.

| Before: current behavior | After: proposed addition | Why |
|---|---|---|
| Hidden state is durable, but only the latest in-memory Undo target is reachable. | Browse retained hidden stories after restart and restore one at a time. | Makes hiding safe beyond the current session. |
| All/Unread filtering exists; there is no Read-only view. | Add an explicit All / Unread / Read status selector later. | Finds a story already read without inventing timestamps. |
| Sources & health already lists status and last success; backoff details stay in host data. | Show an actionable failure summary and honest next-eligible timing. | Explains a quiet or partially failing feed without another dashboard. |

### Hidden persistence and recovery

- `src-tauri/src/db.rs:1185–1209` merges `read`, `saved` and `hidden` into SQLite `states`, keyed by profile/article. Sending only `hidden:false` preserves Saved and Read. No new storage mechanism is needed.
- `src/App.tsx:87,536–568,863–867` holds a single transient Undo target. It now handles acknowledged-write/readback failure and import epochs. The two findings in `daily-use-review.md` have corresponding fixes in current source and regressions in `tests/e2e/daily-recovery.spec.ts`; **do not propose them again as missing features**.
- `src/model.ts:8–12` excludes hidden articles from every ordinary collection. `EmptyHeadlines.tsx:11–15` tells readers hidden Saved items are not deleted, but only offers Browse headlines—not recovery.
- A fresh read-only Node probe transpiled the actual model and EmptyHeadlines component in memory. With one saved/hidden article, All and Saved both returned zero visible rows. Actual server-rendered copy was **“Your cache is empty / Refresh feeds”** in All and **“No visible saved stories / Browse headlines”** in Saved. The All message is still false for an all-hidden cache; this belongs in the recovery increment, not a general onboarding rewrite.
- Snapshot is not an inventory of every retained article: `db.rs:564–582,1043–1044` selects newest 5,000 plus the current profile's older saves, then `intelligence.rs:26–46` applies profile preferences. An unsaved hidden item can disappear from that projection after preference changes. Search is separately capped and the renderer intersects results with accepted snapshot IDs (`App.tsx:477–490`). A client-only Hidden filter therefore cannot promise reliable recovery of all retained hidden state.
- Retention remains consequential: `db.rs:736–750` prunes unsaved articles by age/cache size, but protects articles saved in any profile. Recovery cannot resurrect deleted articles. Do not retain hidden articles forever or silently convert them to Saved.

### Saved, unread and “history”

- Saved navigation already clears query/kind/Unread (`App.tsx:361–370`). Saved+Unread false-empty recovery is already covered by `tests/e2e/daily-empty.spec.ts`. J/K keeps a stable unread sequence, rows are paginated at 100, and older Saved items are supported. Preserve all of this.
- `Article.history` is **publisher title/excerpt revision history**, populated during ingestion, not reading history (`db.rs:370–381`; `src/types.ts:60`; `Coverage.tsx`). Never repurpose it.
- Article state has a Boolean `read`, not `readAt`, `lastOpenedAt` or an event log. A chronological “Recently read” claim would require new host-owned data, backup validation, retention/privacy decisions and compatibility work. A Read-only filter is supported now; a true reading timeline is not a small frontend change.

### Source health and first run

- Sources & health already exists in sidebar/settings. It shows enabled state, failure/status text, last successful retrieval, storage/AI permissions and source links (`Settings.tsx:535–615`). Source settings are explicitly shared across profiles.
- Host already stores `lastAttempt`, `retryAt`, `failures` and `refreshMinutes`. `db.rs:891–923` honors both interval and backoff even for manual refresh. The TypeScript Source shape omits those scheduler fields. Do not add a fake “Retry now” button that bypasses or misrepresents this policy.
- Empty cache → Refresh feeds, no enabled sources → Manage sources, delayed search, caught-up Unread and retry after refresh failure already exist and are tested. First successful load already bypasses the new-items banner (`tests/e2e/first-load.spec.ts`). No welcome wizard or mandatory configuration tour is warranted.
- A never-successful source with an empty cache still shares generic empty-cache guidance; a failed refresh can also leave the user without source-specific next steps. Improve these branches with the existing health data, not a duplicate onboarding system.

## Top 3 actionable additions

### 1. Durable Hidden stories recovery — implement this increment

**Exact user scope**

1. Add **Hidden stories** immediately below Saved stories in existing navigation, as persisted tab mode `hidden`. Use an inline main-pane recovery view, not a new modal/dashboard. Existing screenshot evidence shows the navigation already scrolls; retain that behavior rather than compressing text or adding decorative cards.
2. List the current profile's **retained** hidden stories, independent of relevance preferences and the ordinary snapshot window. Show title, publisher, publication date, Saved/Read state and a labeled **Restore** button. Order by `firstSeen DESC, id ASC`; explain “Newest retrieved first,” not “Recently hidden.” No hidden timestamp exists.
3. Add local search labeled **Find hidden title or publisher** (case-insensitive, all whitespace-separated terms must match the combined title/publisher text). Filter before 100-row pagination; preserve complete reachability. Do not silently reuse ordinary search's 5,000-match cap. No new type/unread/saved filters in this recovery view.
4. Browsing this view, searching, changing pages and restoring must not mark articles read, open the ordinary reader, fetch media or invoke AI. This is recovery management, not a second full reader. Opening an original is out of this first slice.
5. Restore writes only `{op:"article_state", profileId, articleId, hidden:false}`. Disable duplicate submissions for that target; confirm by reading the hidden collection again. Preserve saved/read/group state. Remove the row on confirmed absence; preserve retry/reload affordances on failure. Acknowledged restore followed by failed confirmation says that confirmation failed, not that the write failed.
6. Scope reads and write continuations to profile, tab/view identity and import epoch. A late result cannot refill another profile's list or replace a newly imported workspace. Reuse the existing mutation acknowledgement/epoch discipline; do not weaken transient Undo.
7. Successful restore stays in Hidden stories and announces **Story restored**; keep keyboard focus on the next Restore button, previous if at the end, or the empty-state action. Do not auto-open or auto-mark-read. Explain that ordinary profile filters still apply after restoration; Saved items remain available through Saved.
8. Add **View hidden stories** to the hidden-Saved empty state and an honest all-hidden state. A genuinely empty cache retains its delivered Refresh feeds behavior. Hidden's own empty state says **No hidden stories**; a failed collection read must never appear as an empty collection.
9. Include concise retention copy: “Hidden stories are recoverable while retained in your local cache. Saving protects a story from ordinary cache cleanup.” Keep current source-rights and backup privacy rules.

**Minimal technical approach**

- Add `hidden_stories` to the database request match with a required, validated `profileId`. Query `states JOIN articles` for that profile with `json_extract(states.data,'$.hidden') = 1`; use the existing `read_articles` state overlay. Return `Article[]`, with no relevance ranking or preference filtering. Do not widen normal snapshots to solve recovery.
- **Register the operation as read-only in `src-tauri/src/lib.rs:813–830` (`changed`).** Unrecognized operations currently emit `data-changed`; omitting this registration would make a subscribed recovery view trigger its own reload loop. Add a host regression that `changed("hidden_stories")` is false and that repeated reads do not mutate state.
- Return all retained matches in that scoped read; existing database retention/saved limits bound normal datasets. UI mounts only one 100-row page. If later measurement shows payload cost matters, paginate this endpoint then—not a generic query framework now.
- Implement `src/HiddenStories.tsx` as the small inline component for query/loading/error/search/page/restore state. Subscribe only while mounted, coalesce concurrent invalidations, and invalidate pending results on unmount/profile/import. Keep ordinary collection data and the hidden result set separate; do not merge hidden-only IDs into accepted headlines or the new-items queue.
- Extend the Tab mode union and Rust `validate_workspace`. Backups already call workspace validation; add round-trip tests for the new mode and verify old backups remain accepted. No database schema change. Old 0.3 binaries may reject a backup containing the new mode; document forward-only compatibility rather than pretending otherwise.

**Files likely to change**

- Production: `src/HiddenStories.tsx` (new), `src/App.tsx`, `src/EmptyHeadlines.tsx`, `src/types.ts`, `src/daily-use.css` (only necessary layout/state styling), `src-tauri/src/db.rs`, `src-tauri/src/lib.rs` (read-only event classification).
- Tests: `src-tauri/tests/backend.rs`, `src-tauri/tests/backend_limits.rs`, `src-tauri/tests/host/unit.rs`, `tests/e2e/fixture.ts`, `tests/e2e/hidden-stories.spec.ts` (new), `tests/e2e/daily-empty.spec.ts`, `tests/e2e/daily-recovery.spec.ts` as needed for interaction with existing Undo/import.
- Documentation after delivery: `docs/IPC-CONTRACT.md`, `docs/v03-guide.md` or the parent's new release guide. Do not modify release/package versions as part of this feature slice.

**Acceptance / strict TDD order**

Each numbered slice is its own RED → minimal GREEN → regression check, not all tests followed by all code. Use real temporary SQLite files for host persistence; browser fixture tests are only renderer evidence.

1. **Durable scoped query:** first write/run a host test that saves+hides A, closes/reopens the database, and retrieves A via `hidden_stories`; another profile with the same article ID must not inherit its hidden state. Observe failure for the missing operation before implementation. Then add only the query.
2. **Projection independence:** first fail tests for hidden unsaved A excluded by changed preferences, and an older hidden A retained because another profile saved it. Both remain recoverable without changing normal snapshot/filter results. Verify deleted/pruned A is absent and invalid profiles are rejected.
3. **Persistent navigation:** first fail workspace-save/backup-round-trip tests for mode `hidden`; minimally allow it. Existing modes, detached tabs and old backup fixtures remain valid.
4. **Visible recovery:** first fail browser tests for Save → Hide → dismiss Undo → reload → Hidden stories → Restore. Read back state: `hidden:false`, same saved/read/group flags. Merely visiting Hidden must issue no `read:true` writes. Then implement navigation/view/restore.
5. **Correct failure/race handling:** one failing case at a time for rejected query, rejected restore, acknowledged restore plus rejected readback, same-ID profile switch, import replacement and cross-window state change. Use explicit held promises in the fixture, not arbitrary sleeps. After releasing old responses, assert no stale list, obsolete notice or wrong-profile mutation.
6. **Reachability and focus:** first fail 201-row page/search-last-item checks, restore-last-row/page-clamp behavior and keyboard focus-after-removal checks; then implement the smallest page/search/focus logic. Verify at most 100 mounted rows. Check 5,000 hidden rows with existing performance measurement conventions, without adding a hard timing assertion to a flaky browser test.
7. **Contextual empties:** first fail All-with-all-hidden and Saved-with-hidden-saves CTA tests; minimally update EmptyHeadlines. Run existing empty-cache, saved+Unread, first-load and failed-search cases unchanged in meaning.
8. **Native acceptance before delivery:** isolated test appdata only: hide, restart executable, recover, restart again and verify saved/read flags. Check main/detached profile isolation, narrow width, 200% zoom and no auto-loaded media/AI. Never launch a verification build against real appdata.

**Primary risks:** ordinary snapshot omissions mistaken for deleted state; accidentally auto-reading on recovery; stale profile/import continuations; backup mode compatibility; whole-result IPC payload under large saved collections; false expectation of indefinite retention. The scope above explicitly bounds each one.

### 2. Read-only retrieval without a fabricated reading timeline — next increment

**Scope:** replace the ordinary list's Unread checkbox with a native **Reading status** selector: All / Unread / Read. Apply it after existing collection and content filters. Default/reset is All, matching today's sidebar/tab behavior; do not change navigation persistence or mark-read behavior. Hidden recovery remains independent. Label the option **Read**, never “Recently read.”

**Acceptance:** Read shows only visible `read:true` stories in All/Saved/Your brief/watchlists; changing it does not write article state; changing to Unread preserves existing J/J/K semantics; Mark unread removes the row from Read while retaining a usable reader and stable keyboard behavior; filtered-empty CTA resets status as well as query/type/topic. Search, pagination and Saved older than the snapshot ceiling remain reachable under existing cache semantics.

**Files:** `src/App.tsx`, `src/EmptyHeadlines.tsx`, optionally `src/model.ts` for the pure predicate; `tests/filter.test.ts`, `tests/e2e/reader.spec.ts`, `tests/e2e/daily-empty.spec.ts`, `tests/e2e/keyboard-scroll.spec.ts` and other existing tests that locate the Unread checkbox.

**Risks:** label/control change affects shortcut tests and empty-state branches; Read is a current Boolean, not proof of opening time, full reading or original-publisher visits. Do not add timestamps, activity logging, Clear history, analytics or retention changes under this label.

### 3. Source-health actionability, including failed first retrieval — later increment

**Scope:** retain Sources & health; surface a compact enabled-source failure count beside its current entry and a contextual **Review source failures** action after partial refresh failure. In the existing health rows display last attempt and next eligible attempt using stored `retryAt`, `lastAttempt` and `refreshMinutes`. Next eligibility must respect both backoff and minimum interval. Say “Eligible after …”, not “Will refresh at …”. Add an empty-cache branch for enabled sources that have failed but never succeeded, pointing to health with existing refresh recovery still available. Do not add a wizard, new polling, automatic permissions or scheduler bypass.

**Acceptance:** distinguish not-yet-fetched, disabled, failed-never-succeeded, healthy cached and partially failed states. Disabled sources do not inflate the failure count. A 429/backoff source does not advertise an immediate retry. The source-failure CTA opens the existing panel; cached stories remain visible. No feed requests are triggered by inspecting health, and no new default sources/providers are enabled.

**Files:** `src/types.ts` (optional host scheduler fields with legacy-safe defaults), `src/Settings.tsx`, `src/App.tsx`, `src/EmptyHeadlines.tsx`, optionally `src/model.ts` for a tested eligibility projection; `tests/e2e/daily-empty.spec.ts`, `tests/e2e/errors.spec.ts`, `tests/model.test.ts`. Only touch host code if actual inspection finds missing response fields; current source documents already persist them.

**Risks:** confusing raw error text with structured state; old backups without scheduler fields; promising an exact scheduler wake-up; alarming on a disabled source. Prefer numeric failures where present and conservative text otherwise.

## Alternatives and scope decision

- **Client-only Hidden mode:** smallest diff, but loses hidden unsaved items excluded from snapshots by preferences and misses retained cross-profile older items. Acceptable only if explicitly labeled as recovery within the current accepted cache; not recommended for dependable daily use.
- **Dedicated retained-hidden query + inline recovery view:** recommended. One new read path reuses established writes, persistence and UI conventions without changing normal ranking/search.
- **Chronological History / Recently hidden timeline:** defer. Requires trustworthy read/hide timestamps and backup/privacy/retention semantics. Existing revision history is not a shortcut.

Approve **addition 1 only** for the first implementation. Additions 2 and 3 are ordered follow-ups, not implicit acceptance criteria for the recovery feature.

## Validation and evidence boundary

Future implementation commands, from the repository root:

- `cargo test --manifest-path src-tauri/Cargo.toml --test backend hidden_stories_persist_and_are_profile_scoped` for the first proposed host RED/GREEN test, then run each subsequent named slice and the complete Rust suite.
- `npm run test:e2e -- tests/e2e/hidden-stories.spec.ts -g 'restores a hidden saved story after reload'` for the first proposed renderer RED/GREEN test, then existing recovery/empty/reader/keyboard regressions.
- Final gates: `npm run typecheck`, `npm test`, `npm run test:e2e`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run build`, then isolated native checks. Coordinate with the parent before full builds/tests; the existing Playwright config owns port 1420 and does not reuse an existing server.

This proposal did **not** execute these future tests, launch the application, alter user data, or re-certify 0.3. The fresh Node probe above executed current source only and exited 0; it is not a browser/native persistence test. Visually inspected stored native release evidence `docs/evidence/v02-reader-v03-release-main.png`; no new live-browser observation is claimed.

Tooling issue: the installed Impeccable skill's referenced `scripts/context.mjs` is absent. Used actual PRODUCT/DESIGN files and the bundled `references/skill-reference/product.md`; no installation/config changes made. The `.Codex` research-capture rule is absent; the available Desktop harness equivalent assigns publication of subagent reports to the commander. Parent owns any required Mission Control capture. No external publication from this read-only task.
