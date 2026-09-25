# v0.4 frontend delivery and verification

## Delivered scope

- **Hidden stories** is a persisted navigation mode immediately after Saved stories. Its separate recovery surface uses `hidden_stories {profileId}` rather than the ordinary snapshot or FTS search. It shows retained title/publisher/publication date/Saved/Read state, newest retrieved first, with retention and ordinary-filter caveats.
- Case-insensitive, whitespace-token title/publisher search runs over the complete returned collection before 100-row pagination. `/` and Ctrl+K focus this local search. Browsing, searching, paging and restoring do not open the reader, mark read, load media, open originals or invoke AI.
- Restore sends only `article_state`, `profileId`, `articleId`, `hidden:false`. A new collection read confirms absence. Acknowledged writes with failed confirmation explicitly remain unconfirmed, offer Reload, and prevent another restore until resolved. Successful removal restores keyboard focus to the next/previous Restore button or the empty action, including last-page clamping.
- Mounted recovery reads reuse the existing coalescer and subscribe only while mounted. Reads begun before acknowledgement cannot consume a later mutation's confirmation token. Profile/tab unmount and import replacement invalidate old reads and acknowledgements; import hides the old recovery surface immediately and remounts against the replacement database.
- All-hidden and hidden-Saved empty states offer **View hidden stories**, instead of claiming an empty cache. Initial/read failures never render the No hidden stories empty state.
- Sources & health shows structured enabled-source failure counts, last attempt, and eligibility after `max(retryAt, lastAttempt + clamp(refreshMinutes, 5, 1440) * 60)`, matching the existing host scheduler's 30-minute fallback. Disabled sources are excluded from counts. Missing legacy scheduler facts remain unknown rather than fabricated. Raw host status, source links, enable controls, storage, AI and media permissions remain available.
- Failed initial retrieval offers source review plus existing Refresh feeds. Partial refresh failure and failed refresh expose **Review source failures**. Inspection adds no polling, feed request, scheduler bypass or default permission/source/provider enablement.
- `workspaceIntent` now pre-reads `workspace_get`, preserving revision CAS, one conflict retry and authoritative post-write snapshot confirmation. The fixture validates profile scope for the new reads and applies article/workspace writes to the requested profile, not whichever profile was last snapshotted.
- Ordinary Unread checkbox and J/J/K semantics remain unchanged. No host, dependency, version, release, installation or production-data edits were made by this frontend slice.

## Observed RED → GREEN record

Tests were introduced/run before the corresponding production changes, one behavioral slice at a time. The initial failures below were observed, not inferred:

| Slice | Observed RED | Verified GREEN |
|---|---|---|
| Workspace-only pre-read | CAS test expected two `workspace_get` calls, received zero | Two pre-reads, expected revisions `[0,1]`, exactly one confirmation snapshot; other-window tab retained |
| Durable recovery navigation | Hidden stories button absent after hide/reload | Save → Hide → dismiss Undo → reload → Hidden → reload → Restore; saved/read/group preserved, only hidden:false written |
| Full reachability | 201 mounted rows rather than 100 | 201-row last page, final-publisher/title multi-token search, page clamp, focus and scroll recovery |
| Query/write/confirmation errors | Raw service error lacked recovery guidance; later focus assertion exposed premature focus-token clearing | Rejected reads/writes recover; acknowledged restore remains disabled/unconfirmed until Reload; empty-action focus restored |
| Cross-window invalidation | Event left two hidden rows after authoritative removal | Mounted subscription coalesces an eight-event burst to one additional read |
| Import epochs | Imported hidden title absent behind delayed old read/write acknowledgement | Replacement view loads before old response release; no stale title/notice or post-import state/workspace save |
| Honest ordinary empties | All-hidden cache still claimed empty | All and Saved offer persistent hidden recovery; existing empty-cache/Unread/search tests still pass |
| Source health model | Eligibility/failure functions missing | Backoff vs interval, min/max clamp, zero timestamp, absent/null legacy fields and disabled failure counts |
| Source health UI | Enabled-failure summary absent; later legacy assertion exposed an unsupported “Last retrieval succeeded” claim, and prior success incorrectly promised retained cached stories | Disabled/failed/legacy states use recorded facts only; health inspection without fetch/mutation, retained cached rows |
| Failed first retrieval | Recovery heading/action absent | Source review plus existing refresh; partial failure keeps its new cached row and review CTA |
| Coalesced confirmation ordering | Restored row disappeared but status said `0 hidden stories`, not Story restored | Pre-write held read cannot consume the acknowledgement; dirty follow-up confirms and restores focus |
| Local shortcut/error truth | `/` did not focus hidden search | `/` and Ctrl+K focus local search; failed empty-list reload shows error, not an empty claim |
| 200% short viewport | First row's viewport intersection was only 0.3793 | At short heights, the entire recovery surface scrolls so guidance cannot crush the rows; full first-row intersection |
| Short-height pagination | Next-page first title had viewport intersection zero | Page change scrolls the next page's first row into view |
| Unconfirmed second restore | Other Restore button appeared enabled although the operation was blocked | All Restore controls visibly wait until collection confirmation succeeds |

Additional profile/tab delayed-read/delayed-ack regressions and workspace-only pre-read profile/import races passed against the preceding guarded implementation. They extend verification; no fabricated initial RED is claimed for these already-covered paths.

## Final executed gates

From the repository root:

```text
npm run typecheck                         PASS
npm test                                  PASS — 4 files, 13 tests
npm run build                             PASS — 1,601 modules; JS 328.53 kB (98.96 kB gzip)
npm run test:e2e -- --workers=3            PASS — 152 tests, 1.1 minutes
```

The complete browser suite includes existing reader/Unread/keyboard, media/AI permissions, source connections, transient Undo, import, detached-profile/workspace, quotation validation, stable arrivals, and token contrast regressions. No assertion was weakened. The CAS regression was strengthened to assert the new pre-read and retained full confirmation semantics. `tests/e2e/hidden-stories.spec.ts` contains the recovery and explicit-promise-barrier race checks.

A synthetic 5,000-retained-hidden-row browser measurement in the final complete run mounted **100** rows, found the final row by title/publisher with **one** mounted result, and issued no FTS search/article-state/media/AI call. Observed navigation-to-assertion time was **76.1127 ms**, local search-to-assertion **21.8165 ms**. These are single browser-fixture/Playwright samples, including test-driver overhead, not native/SQLite measurements, p95 claims or timing assertions. The test attaches its JSON to the Playwright report on every run.

## Actual screenshot review

`tests/e2e/v04-visual.spec.ts` captures both new surfaces at 1440×900, 1024×768, 480×800 and a 720×450 CSS viewport with 2× device metrics (200% layout emulation). It checks language/title, horizontal overflow, console/page errors, full-row viewport intersection and settings close-button reachability; control-size metrics are attached to the Playwright report. The inherited compact desktop controls remain compact, not 44px touch-first controls.

| Before | After | Why |
|---|---|---|
| Fixed explanatory block left only a strip of the recovery row at 200% | Short-height layout scrolls the entire recovery pane; full row and Restore control are visible together | Zoom must preserve reading context, not merely a technically clickable button |
| Whole-pane scrolling retained the old page-bottom offset | Page changes reveal the next page's first row immediately | Bounded rendering must preserve keyboard and scroll reachability |
| No retained-recovery surface | Restrained, divided rows, familiar system typography, explicit state and no reader/AI controls | Recovery management should not look like a second news reader or dashboard |

Inspected captures (not merely generated):

- [Recovery, desktop](evidence/v04-frontend-hidden-1440-1.png)
- [Recovery, intermediate](evidence/v04-frontend-hidden-1024-1.png)
- [Recovery, narrow](evidence/v04-frontend-hidden-480-1.png)
- [Recovery, 200% layout](evidence/v04-frontend-hidden-1440-2.png)
- [Source health, desktop](evidence/v04-frontend-sources-1440-1.png)
- [Source health, narrow](evidence/v04-frontend-sources-480-1.png)
- [Source health, 200% layout](evidence/v04-frontend-sources-1440-2.png)

The intermediate source-health screenshot is also produced at `evidence/v04-frontend-sources-1024-1.png`. Long multilingual titles wrap; existing semantic text tokens passed the full suite's ≥4.5:1 checks. Source-health content scrolls within the existing dialog at short heights. Zoom recovery screenshots are intentionally scrolled to show a complete recovery row; the header remains reachable by scrolling up.

## Files and remaining boundary

Production: new `src/HiddenStories.tsx`; updated `src/App.tsx`, `src/EmptyHeadlines.tsx`, `src/types.ts`, `src/daily-use.css`, `src/Settings.tsx`, `src/model.ts`.

Tests: updated `tests/e2e/fixture.ts`, `tests/e2e/races.spec.ts`, `tests/e2e/daily-empty.spec.ts`; new `tests/e2e/hidden-stories.spec.ts`, `tests/e2e/source-health.spec.ts`, `tests/e2e/v04-visual.spec.ts`, `tests/source-health.test.ts`. This report plus eight PNG captures are the documentation evidence. Build and Playwright report directories are generated outputs.

Tooling issues: the installed Impeccable wrapper's referenced `scripts/context.mjs` is absent; actual PRODUCT/DESIGN and its bundled product-register reference were used. One intermediate three-worker run timed out in initial `page.goto`, before feature assertions; rerunning succeeded, and the final complete three-worker run passed with the standard 30-second test timeout.

This is real Chromium renderer evidence with an explicitly synthetic IPC fixture. It is **not** native Windows/WebView2 restart, SQLite persistence, monitor movement, real feed access, or packaged-executable evidence. Parent/backend owners retain those acceptance gates and release integration. Hidden stories remain subject to existing cache retention; restored ordinary visibility still follows profile filters. A backup containing mode `hidden` requires a compatible host; do not assume an older binary accepts it.
