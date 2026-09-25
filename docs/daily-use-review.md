# Independent daily-use regression review

Reviewed 2026-09-23, 23:09 PDT. **Two confirmed, actionable findings: one P1 and one P2.** No application edits. This is a source and isolated-controller review, not native verification or a fresh browser performance benchmark.

## P1 — A successful Hide loses its only recovery action when readback fails

**Location:** `src/App.tsx:267–277,529–539` (`action`, `hideStory`); hidden rows are excluded by `src/model.ts:8–12`.

`action()` reports failure for both a failed mutation and a failed subsequent snapshot. `hideStory()` creates the Undo target only when that combined operation returns true. Therefore a committed Hide followed by a transient `snapshot`/`window_context` failure leaves no Undo, despite having changed persistent article state.

**Minimal reproduction:**
1. Select a saved, visible story A.
2. Let its `article_state {hidden:true}` succeed, but reject the following snapshot read. Do not reject the mutation itself.
3. Recover snapshot reads and refresh/read back the workspace.
4. A is still saved and now hidden; its row disappears, and no Undo offer exists. The normal list/search filters exclude it. This is loss of ordinary UI access, not deletion of the saved data.

**Executed evidence:** An in-memory harness transpiled the actual App controller and actual `coalescedRead`, with only hooks/IPC replaced by deterministic test doubles. Assertions passed for backend `hidden === true`, recovered visible row count `0`, and `hiddenUndo === undefined`. The existing `daily-recovery.spec.ts` rejects `article_state`; it does not exercise a successful Hide followed by failed readback.

**Smallest correction:** Separate mutation acknowledgement from readback success. Preserve a profile/article-bound recovery target once Hide is acknowledged, even if the refresh fails, while showing the readback error. Do not announce a failed mutation as hidden. Preserve the recovery target if Undo itself or its confirmation fails. Apply the import-epoch guard in the next finding as well.

**Regression acceptance:** Successful Hide → rejected readback → successful refresh still offers Undo; Undo restores the same profile/article with `saved:true`. Repeat with a same-ID article in a different profile and confirm it is not modified.

## P2 — Coalesced readback crosses an import epoch and resurrects obsolete Undo

**Location:** `src/App.tsx:212–240,267–277,529–550`; `src/coalescedRead.ts:15–24`.

Import advances `workspaceGeneration`/`loadGeneration` and clears Undo, but `hideStory()` has no import-generation guard. Pending callers share a later readback batch solely by the `reset` flag. A pre-import Hide confirmation and the import reset can consequently resolve from the *same post-import snapshot*. The old Hide continuation then recreates Undo against the restored database. Its profile-ID check does not distinguish a replacement database containing the same profile/article IDs.

**Minimal deterministic reproduction:**
1. Load profile `default` with saved A. Start a background snapshot and hold its response.
2. Hide A. Allow the mutation to commit; its explicit readback queues behind the held snapshot.
3. Import a valid backup that also contains `default`/A with `hidden:true`. Allow import to commit. Its reset readback queues behind the same held snapshot.
4. Release the old snapshot. Its generation check discards it; the coalescer runs one dirty follow-up with `reset:true`, satisfying both waiting callers.
5. The pre-import Hide callback recreates the cleared Undo offer. Clicking it changes the imported A from `hidden:true` to `hidden:false`, although the imported workspace was meant to replace the prior action history.

**Executed evidence:** The actual coalescer plus transpiled App controller reproduced this ordering; assertions confirmed the stale Undo target reappeared and its subsequent Undo changed restored backup state. A separate ordering with a delayed mutation acknowledgement also reproduced the obsolete callback. No native timing claim is made.

**Smallest correction:** Bind Hide/Undo continuations to the workspace/import epoch as well as the original profile/article. Discard pre-import UI continuations even if their shared readback resolves successfully. Preserve read coalescing; the defect is that a successful batch is treated as proof that an old action still belongs to the current workspace. Ensure obsolete continuations cannot clear a newly selected story via `closeStory()` either.

**Regression acceptance:** Add the held-background-snapshot → Hide → import → release ordering. The imported hidden flag and workspace selection must remain exactly as restored, with no pre-import Undo offer or selection save applied afterward.

## Scope checks and results

| Area | Result and evidence boundary |
|---|---|
| Coalescing and late profile reads | Existing pure coalescer test passed. An independent controller trace held the old profile snapshot, switched the native-context test double to profile B, then released it: final UI/profile snapshot remained B. New requests arriving during a read form a follow-up rather than consuming the old result. Import-epoch continuation failure is detailed above. |
| Article identity / permissions | `reconcileArticles` compares the entire serialized article rather than only `updatedAt`. An executed same-timestamp correction changed `aiAllowed`, excerpt and media; the authoritative object replaced the old identity. `App.tsx:1193–1204` separately gates media on source permission and keys Summary on its actual inputs. No identity-reuse regression found. This does not constitute an end-to-end authorization audit. |
| Entire accepted cache | An executed controller test enumerated every page of 5,101 accepted articles: **5,101 unique IDs, 52 pages, at most 100 rows per page**, including saved tail ID `5100`. Pagination slices only `rows`, not stored `data.articles`; collection filters and keyboard navigation operate before slicing. No truncation to the first page/first 5,000 was found in this frontend path. |
| Native cache boundary | Source inspection of `db.rs:564–582` confirms snapshot input is the newest 5,000 **plus this profile's older saved articles**, then profile ranking/filtering applies. Search SQL separately has its existing `LIMIT 5000`. “Every accepted article is pageable” is not a claim that every physical database record appears in every profile or that an arbitrarily broad search returns more than 5,000 matches. |
| Keyboard reachability | `App.tsx:613–626` indexes `navigationRows`, not `pageRows`, and moves the rendered page to the selected item's full-collection index. The unread sequence keeps prior members while filtering hidden/deleted/collection-excluded items. Reviewed the existing 5,101-row boundary/search/Saved test and J/J/K test, but did **not** rerun browser keyboard/focus tests in this review. |
| Collection semantics | Rows remain native `<article>` elements with actual headline `<button>` controls, not a newly introduced listbox with incomplete keyboard behavior. Pagination is a named `<nav>` with native First/Previous/Next/Last buttons. **The `.story-list` container is a `div`, not a semantic list/listitem structure**; this review does not certify screen-reader list announcements or positional announcements. Source locations: `HeadlineRow.tsx:10–20`, `App.tsx:1089–1102`. |
| Profile-bound Undo | The target includes profile ID; execution is rejected when the current profile differs or a switch is active (`App.tsx:541–550`). Notice is outside the narrow-hidden footer. The acknowledged-Hide/readback and import-epoch holes above remain. |
| Pane isolation / clamping | Executed the real hook with deterministic hook/storage doubles: profile, window label and tab each isolate storage; preferred width 600 renders as **600 → 320 → 600** for widths 1440 → 640 → 1440 without changing the stored preference. Invalid persisted width falls back to 390 on fresh mount. Actual narrow-layout display and native restart persistence were not exercised. |
| Idle polling | Executed the real `LiveDiscussion` effect with a fake clock/event targets: off schedules 5,000 ms, visible enabled schedules 1,000 ms, hidden schedules 5,000 ms. Ten focus events during a held read produced one read. Unmount removed wake listeners and pending timer. These are scheduling assertions, not CPU/battery/native stream measurements. |

## Verification and provenance

- Read `graphify-out/GRAPH_REPORT.md` before source inspection. HEAD is `a85405469939361f2512266ee3f4b21240ac7e8e`; the reviewed application files are untracked in this checkout, so HEAD alone does not identify their contents.
- Fresh command: `npm test -- tests/model.test.ts tests/dates.test.ts tests/filter.test.ts` — **3 files passed, 11 tests passed**, exit 0.
- Additional isolated probes ran against source transpiled in memory through installed TypeScript and Node. App probes exposed controller closures at the render return and used deterministic hook/IPC doubles; they did not execute React DOM/effect scheduling. The LiveDiscussion probe separately executed its real effect callbacks with deterministic timers. All reported assertions exited 0. No test files, server, native executable, database, external service, or benchmark were created/launched by this review.
- Initial probe invocation through a long shell command failed quoting; a second probe initially matched the nested runtime guard instead of the render guard. Both harness-only errors were corrected before any findings were asserted. Successful probes used direct Node stdin and the exact render-boundary match.
- Reviewed source SHA-256:
  - `src/App.tsx`: `472718d0fb26f515817b52e383705acc6ca4e9b7811312e45b5cf97ab981dc0b`
  - `src/coalescedRead.ts`: `1716a057c6806ca04801d034f257da222de78be349765b0e0318d87b3844251f`
  - `src/model.ts`: `849b965a2a227e462b8e1b7b2aae1a6d3ed41d36c51d8555098cc535c1549669`
  - `src/usePaneWidths.ts`: `b06599cb6cabf171f3167c364a48443cebc220b368ec2e7427af48ab329baf57`
  - `src/LiveDiscussion.tsx`: `4d58b58c58b718a6ebe69d6179396e69e6a9ef046167519d1e8d19747131338c`

**Owned artifact:** this report only. No application edits or independent sector-grounding review. No native verification claimed. The referenced `.Codex/rules/common/research-capture.md` is absent; the available Desktop harness equivalent assigns subagent publication to the commander. Parent may publish this report on receipt if required.
