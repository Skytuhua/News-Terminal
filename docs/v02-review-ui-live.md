# v0.2 frontend / live integration — independent read-only review

## Verdict

**Five reproducible frontend defects remain despite the existing suite passing.** Prioritize stale briefing permissions/content and out-of-order profile changes. No application or test source was edited in this review.

This is **not final native verification**. Browser evidence uses explicit `tests/e2e/fixture.ts` data, including invented example.org headlines. The separately identified HN smoke result below is real network metadata, not a browser/native-window screenshot.

### Verified execution

| Command / exercise | Actual result |
| --- | --- |
| `npm run typecheck` | Exit 0. |
| `npm test` | 3 files, **6 tests passed**. |
| `npm run test:e2e -- --reporter=list --output=C:/Users/user/AppData/Local/Temp/news-v02-review-playwright` | **60 passed**, 38.8 seconds; independently confirms the reported frontend total. |
| `cargo test --lib live -- --nocapture` | **20 passed, 6 ignored**, 68 filtered. This name filter also selects media/rights tests; it is not 20 live-only tests. |
| `cargo test --test v02_live_host -- --nocapture` | **1 passed**. |
| `cargo test --lib live::tests::real_network_smoke -- --ignored --exact --nocapture` | **1 passed**; real fixed-origin HTTPS/SSE. Reported connected, 20 items, first ID `49823332`, publication `2026-09-23T22:14:52Z`, receipt `2026-09-23T22:15:27.193Z`, observed `2026-09-23T22:15:29.302Z`. The existing smoke includes disable/readback. |
| Additional in-memory Playwright fixture exercises | Reproduced all five findings below without editing application/test files. |

Repository graph was read before code inspection; its recorded commit and current HEAD both were `a85405469939361f2512266ee3f4b21240ac7e8e` (report uses abbreviated `a8540546`). The working tree contains uncommitted implementation and another backend worker was active, so these findings refer to the inspected source, not a frozen release commit.

## Findings and minimal fixes

### 1. P1 — Briefing retains superseded excerpts and AI permission after parent refresh

**Location:** `src/Briefing.tsx:16-24,56,60`; `src/App.tsx:158-160,833`; `src/Summary.tsx:83-104,119-137`.

`Briefing` owns a separately fetched `DailyBrief`, but its fetch effect depends only on profile ID, date and its own reload counter. The parent's `data-changed` handler updates `Snapshot`; the briefing key remains the same and the new snapshot/permission state is not passed to it. Its old article objects, excerpts, generated summaries and `aiAllowed` values remain usable until a manual reload or remount. This also leaves profile preference changes and background story corrections unapplied.

**Reproduction:** v0.2 fixture; enable the fixture provider; open Daily briefing, expand per-story AI and generate a summary. Replace the host fixture snapshot with `aiAllowed:false`, empty excerpts/media, and dispatch `data-changed`. Wait for parent readback.

**Observed:** `daily_brief` calls remained **1**; the current fixture snapshot had `aiAllowed:false`; the old excerpt remained visible; the generated summary remained visible; **Summarize excerpt stayed enabled**. This is a renderer stale-policy/content defect. The injected snapshot models a host policy/content change; it does **not** prove a real backend authorization bypass or claim that source disable alone removes excerpt rights.

**Minimal fix:** provide an explicit briefing input/policy revision or subscribe to relevant host changes. Reconcile removals, permission revocations and modified content immediately; use a pending-update affordance for newly arriving stories if stable order is required. Invalidate affected Summary instances/results on article/input/permission revision. Do not remount the entire briefing on every unrelated snapshot or local poll. Retain native authorization as the enforcement boundary.

**Regression:** generate a summary, publish a changed permission/input revision through the host event seam, and assert removed content/result/AI action are invalidated before another user request.

### 2. P1 — A late profile-switch acknowledgement rolls UI back behind the host

**Location:** `src/App.tsx:201-210,98-105,705-712`; native state update is `src-tauri/src/native.rs:711-727`.

`switchProfile` has no request generation, serialization, or disabled selector while a change is pending. Every resolved invocation overwrites `profileRef` and starts a fresh `load`; the existing load generation cannot protect against the *older switch initiating its load last*. Main-window loads deliberately stop adopting `window_context.profileId` after initial startup, so they do not repair this divergence.

**Reproduction:** use `fixture(page, {v02:true, savedProfile:true})`. Wrap only `window_set_profile` before application startup: apply the first switch to `default`, then delay that response by 900 ms. After 100 ms, select `desk-b` and let that response complete immediately. Wait for both requests.

**Observed:** switch call order `["default","desk-b"]`; final UI profile **`default`**; final host fixture's persisted profile **`desk-b`**. Subsequent reading/workspace mutations use the rolled-back UI profile, and restart adopts the other profile.

**Minimal fix:** serialize profile changes and disable the selector during a switch, or maintain latest-intent sequencing including native write ordering and readback. A frontend response-generation check alone does not cover an old native write applied after the newer write.

**Regression:** delayed acknowledgements in both orders; assert rendered profile, snapshot scope, subsequent article mutation scope and persisted native main profile agree.

### 3. P2 — Failed initial status read hides the only disconnect action and falsely says off

**Location:** `src/LiveDiscussion.tsx:35-37,43-50,63,79`; shared-stream lifetime is implemented in `src-tauri/src/lib.rs:92,115,185-188` and `src-tauri/src/live.rs:40-83`.

The stream intentionally outlives its view. On remount, `status` starts undefined. If `live_status` fails, the only action is disabled by `!status`, is labelled **Connect HN stream**, and the empty state says **Live stream is off**. Neither assertion is justified. No unconditional stop action exists even though `live_set(false)` may still work.

**Reproduction:** connect the fixture stream; navigate to headlines; arrange for only `live_status` to fail; return to Live discussion.

**Observed:** stream's last requested setting remained `true`; the action was disabled and labelled `Connect HN stream`; the screenshot simultaneously showed the status failure and `Live stream is off`. Retrying a persistently failing read cannot disconnect.

**Minimal fix:** represent unknown/unavailable status separately from confirmed off. Offer an explicit, idempotent **Disconnect stream** / **Stop stream** action that sends `live_set(false)` without first requiring status. Use the returned snapshot and an attempted readback without claiming confirmation when neither succeeds.

**Regression:** fail status reads after connecting and navigating away/back; assert an accessible stop control remains actionable and no off claim appears until confirmed.

### 4. P2 — Reconnecting leaves the initial snapshot behind a new-items banner

**Location:** `src/LiveDiscussion.tsx:20-26,73,79`.

`initialized.current` becomes true on the first nonempty result and is never reset when an explicit disconnect clears rows. After reconnect, `accept()` intersects the new snapshot with the now-empty old rows, so all received items are hidden. It simultaneously renders a received-items button and the empty state “Waiting for discussion items.”

**Reproduction:** connect, wait for initial row, disconnect, reconnect in the same view.

**Observed:** **0 rows**, `1 received items · Show latest`, and `Waiting for discussion items` together. Clicking Show latest recovers; this is not data loss, but initial reconnect behavior is incorrect and its empty-state guidance is contradictory.

**Minimal fix:** reset the accepted-session initialization when a confirmed disabled snapshot is accepted, and initialize the next nonempty session normally. Keep normal incoming items behind Show latest once the new session has an accepted list. Also ensure an empty accepted list with pending rows is not described as no items received.

**Regression:** same-view disconnect/reconnect and remote-window disable/re-enable followed by status polling.

### 5. P2 — Declared tablist does not implement its expected keyboard pattern

**Location:** `src/App.tsx:587-606`; current alternate shortcuts at `441-475`.

Workspace controls declare `tablist`/`tab` but every tab is a tab stop, there is no ArrowLeft/ArrowRight/Home/End behavior, and no associated `tabpanel`/`aria-controls` relationship. The separate selector and Ctrl+Tab shortcut are useful alternatives, but do not make the declared tab widget behave as assistive-technology users expect.

**Reproduction:** create a second fixture tab, focus the first `role=tab`, press ArrowRight.

**Observed:** focus stayed on tab index **0**; both tab indices were **0**; there were **0 tabpanels**. No claim of a full screen-reader audit is made.

**Minimal fix:** either implement the standard tab keyboard/roving-focus and panel relationship, preserving close actions as separate controls, or use navigation/button semantics instead of promising a tab widget. Preserve the existing Ctrl+Tab and select alternatives.

**Regression:** keyboard-only Arrow/Home/End navigation, a single active tab stop, explicit panel association, close-tab focus restoration.

## Actionable UI changes — Before / After / Why

| Before | After | Why |
| --- | --- | --- |
| Briefing displays old excerpt, summary and permitted AI action after changed host input. | Immediately reconcile policy/content changes and clear affected generated results. | The displayed permission and content must track the authoritative state. |
| Rapid profile changes accept every late acknowledgement. | Serialize/disable while pending or implement latest-intent native reconciliation. | Prevent wrong-profile reading/mutations and restart mismatch. |
| Unavailable live status is presented as off with a disabled Connect button. | Show status unknown and provide an independent idempotent stop action. | Preserve user control of an already-running shared network stream. |
| Reconnect shows received items and “Waiting for discussion items” simultaneously. | Initialize the new session's first snapshot; distinguish pending items from none received. | Remove a visible false empty state and an unnecessary recovery step. |
| Role=tab exposes ordinary independently tabbable buttons. | Implement the advertised keyboard tab pattern or use honest button/navigation semantics. | Align accessible roles with actual keyboard interaction. |

No generic color, spacing, typography or animation changes are recommended by this review.

## Live/backend integration observations

- Parent owns one `Arc<LiveDesk>` shared by dispatches; status is excluded from `data-changed`, while explicit `live_set` is a mutation. Backend Drop requests disable (`lib.rs:91-115,185-188,598-613,653-659`).
- `live.rs` serializes generation changes, uses a worker gate, and drops stale network futures on change. The existing rapid-toggle test passed. Terminal revocation clears metadata; retries honor backoff; item projection excludes comment bodies; the fixed host client rejects redirects/proxies/private destinations. The exercised tests support these narrow claims.
- The host wiring test's name says “shares status,” but its actual assertions only cover startup off, a malformed boolean, an idempotent disable, and empty status. It does **not** establish real native multi-window connect/disconnect, shutdown, or monitor behavior. The real SSE smoke tests `LiveDesk`, not the installed Tauri application.
- No additional confirmed defect was found in the inspected `Connections`, `ReaderMedia`, or `MonitorControls` paths. Their fixture tests cover explicit media loading, bad response rejection, stale selection isolation, official feed conversion/attestation and monitor readback failures. This is limited coverage, not a claim that those surfaces have no defects.
- ReaderMedia's parent key includes profile/article/input metadata; Summary's reader key includes article revision and AI permission. Those protections do not repair the independently cached Briefing objects described above.
- Actual WebView2 IPC, physical mixed-DPI placement, unplugged displays, native process exit and multi-window shared-stream timing were **not** newly verified here.

## Evidence / repeatability

All additional browser exercises used the already available test-mode development server on `127.0.0.1:1421` and Playwright Chromium. Its HTTP endpoint was health-checked before the exercises. An attempted owned background Vite launch exited with a shell/TTY error; cleanup confirmed that process had already exited. The existing server was not stopped. The existing TypeScript fixture was transpiled/imported **in memory**; only the profile scenario added the described response delay before application startup. Mutation seams were `__TEST_PATCH__`, `__TEST_SNAPSHOT__`, `__FAIL_OP__` and `data-changed`. No new fixture/test file or application override was left in the repository.

Screenshots are local, explicit test evidence, not real news:

- `C:/Users/user/AppData/Local/Temp/news-v02-review-playwright/review-reconnect-empty.png` — captured and inspected; confirms finding 4.
- `C:/Users/user/AppData/Local/Temp/news-v02-review-playwright/review-disconnect-deadend.png` — captured and inspected; confirms finding 3.
- `C:/Users/user/AppData/Local/Temp/news-v02-review-playwright/review-stale-brief-permission.png` — captured; finding 1 is established by DOM/state assertions, not inferred from pixels.
- Fresh suite captures inspected: `v02-visual-fixture-v02-desk-visual-480x800-zoom-1/briefing.png` and `v02-visual-fixture-v02-desk-visual-1440x900-zoom-2/screens.png` under that directory. No additional visible clipping defect was established. The scrolled Screens capture retains the close button and Move action. The zoom fixture emulates viewport/pixel density; it is not a physical-DPI test.

Existing visual tests also assert title, document language, viewport overflow and contrast-token thresholds; passing these does not replace a screen-reader audit.

## Scope and limitations

- Sole repository file authored: `docs/v02-review-ui-live.md`. Test/build caches and screenshots are execution artifacts; no source fixes or test-source changes were made.
- Impeccable's configured `scripts/context.mjs` is absent (`MODULE_NOT_FOUND`). Read the existing PRODUCT.md, DESIGN.md and installed product-register reference instead; no design initialization or unrelated files were written.
- The required research-capture rule at `C:/Users/user/.Codex/rules/common/research-capture.md` and the referenced Mission Control directory were not present in this environment. No guessed command or panel post was attempted; parent may capture this report using its actual Mission Control setup.
- Backend rights work was concurrent. Recheck exact backend line references and rerun native verification after integration; the passing commands above describe what was executed, not later changes.
