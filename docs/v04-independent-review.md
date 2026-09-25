# v0.4 independent correctness/security review

## Verdict

**Changes requested: two concrete import-isolation findings.** Ordinary profile isolation, recovery/readback/focus cases, read-only registration, scheduler eligibility projection, and ranking parity passed the focused checks below. Neither finding requires changing the ranking optimization or broadening the hidden query.

Reviewed the graph report first, then `.hermes/plans/news-terminal-v04.md`, the accepted additions in `docs/v04-daily-use-proposal.md`, all three v04 delivery reports, and their actual implementation/tests. Checkout HEAD was `a85405469939361f2512266ee3f4b21240ac7e8e`; application sources are untracked/uncommitted, so this is a current-checkout review, **not an attribution of every defect to a Git diff**.

## 1. P1 — Import in another window can let an old workspace intent overwrite the imported workspace

**Locations:** `src/App.tsx:202–204,215–228,292–320`; `src-tauri/src/db.rs:825–841,1093–1106`; `src-tauri/src/lib.rs:872–877`; `src-tauri/src/native.rs:517–540`.

`workspaceGeneration` advances only in the renderer which invokes `importBackup`. Other windows receive an undifferentiated `data-changed` event and merely reload. Native reconciliation retains windows whose profile/tab IDs still exist. Meanwhile import restores the backup's workspace revision verbatim, and `workspace_save` checks only that revision. A pre-import `workspace_get` response with the same revision therefore remains an accepted write into the replacement database (an ABA conflict).

**Executed renderer reproduction:**

1. Start with profile `default`, workspace revision `0`, tab `home`.
2. Hold the result of the next `workspace_get` using `__TEST_AFTER_DISPATCH__`; click Science to queue an intent.
3. Simulate another renderer's completed import by invoking the fixture host import directly, preserving profile/tab IDs and revision `0` but adding tab `import-only`. Emit the same `data-changed` event that the native host emits. Verify Imported tab appears.
4. Release the old getter response.

**Observed:** the old save is accepted with `expectedRevision:0`; the workspace becomes revision `1` with only Science/home. The imported tab is gone. The conflict retry does not run because there is no conflict.

**Independently confirmed against the real compiled Rust database**, not just the fixture. A temporary Rust executable linked the current `news_terminal_lib` and used only `Database::memory()`. It read `workspace_get`, modified an exported backup to add the tab at the same revision, imported it, then submitted the pre-import workspace with its original expected revision. Actual output:

```json
{
  "importedWorkspace": {
    "activeTabId": "home",
    "revision": 0,
    "tabs": [
      {"id":"home","mode":"all","query":"","title":"Headlines","topic":""},
      {"id":"import-only","mode":"all","query":"","title":"Imported tab","topic":""}
    ]
  },
  "staleSaveAccepted": true,
  "afterWorkspace": {
    "activeTabId": "home",
    "revision": 1,
    "tabs": [{"id":"home","mode":"all","query":"","title":"Late pre-import intent","topic":""}]
  }
}
```

The same missing remote-import invalidation affects the new recovery surface: holding a `hidden_stories` response, then importing externally with unchanged profile/tab identity, left the displayed title **Original hidden** while the replacement store contained **External import hidden**. The replacement collection was blocked behind the old read until it was released. Local import correctly remounts the view; remote import does not.

**Required correction:** make successful database replacement an explicit, cross-window invalidation boundary. Reject pre-import workspace writes at the host even if an imported revision matches; a host-owned import generation/opaque CAS token or an equivalent guaranteed serialization boundary can do this. Notify surviving renderers so they invalidate old workspace intents and remount recovery immediately. A renderer notification alone does not protect a save already dispatched before the event arrives.

**Regression to add:** held getter → import in a different window with the same revision/profile/tab IDs → release. Assert the imported extra tab survives and the old intent is rejected/cancelled, not reapplied to replacement data. Also hold a remote window's recovery read and verify imported content becomes available without waiting for the old response.

**Scope note:** the narrow getter preserves the former revision-only semantics; this is an uncovered import-boundary weakness, not evidence that the getter introduced a new ordinary CAS defect. It prevents claiming the plan's complete import isolation.

## 2. P2 — Local import drains workspace saves, but not an already-dispatched Restore mutation

**Locations:** `src/HiddenStories.tsx:67–81`; `src/App.tsx:215–228`; `src-tauri/src/lib.rs:377–399,434–437`; `tests/e2e/hidden-stories.spec.ts:174–198`.

Restore dispatches `article_state` directly, outside `App`'s workspace queue. Import advances renderer generations and drains only `queue.current`. Unmount/current checks suppress a late response but cannot stop an old mutation from executing after the database has been replaced. The host's hidden-state write has no import-generation check.

**Executed reproduction:**

1. Seed one hidden story `h`, Saved=true. Open Hidden stories.
2. Hold `article_state` **before execution**, using the fixture's existing `__TEST_BEFORE_DISPATCH__` barrier, and press Restore.
3. Through the actual Settings → Backup UI, import a backup with the same profile/article ID, `hidden:true`, and title Imported hidden. Import completes and the replacement hidden row is visible.
4. Release the old Restore request.

**Observed actual probe output:**

```json
{"hidden":false,"visible":"Imported hidden","calls":["article_state","import"]}
```

The imported article's authoritative hidden state became false despite no Restore action against the replacement view. The old component correctly suppressed its continuation; it did not prevent the write. The fixture does not automatically emit native write events, so the displayed stale row in this output is not itself the finding—the post-import state mutation is.

The delivered import test holds `__TEST_AFTER_DISPATCH__`, after the fixture has already changed the old database. It proves delayed acknowledgement safety, but not delayed execution safety. Both are necessary to establish the advertised import boundary.

**Required correction:** establish a mutation/import ordering barrier that covers recovery writes, or reject pre-import mutations using an authoritative generation captured before dispatch. Keep acknowledgement-only delays distinct from not-yet-applied writes; merely hiding/remounting the component is insufficient. Coordinate with finding 1 rather than adding incompatible local epoch mechanisms.

**Regression to add:** the before-dispatch sequence above, asserting the imported story remains hidden after releasing the old request. Retain the existing after-dispatch delayed-ack regression.

**Evidence boundary:** this interleaving was reproduced in Chromium using the real renderer and an explicitly delayed fixture host. It was not reproduced by forcing Windows IPC scheduling. The real host serializes database access but contains no origin-generation check or FIFO transaction guarantee that would establish the missing cross-import ordering contract.

## Focused verification actually executed

| Check | Result |
|---|---|
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test backend --test backend_limits --test v04_ranking` | 24 backend, 3 backend_limits, 6 ranking tests passed |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib read_only_for_change_events` | Both new read-only classification tests passed |
| `npm test` | 4 files, 13 tests passed |
| Existing hidden-stories, races, source-health browser test callbacks | 22 registered cases; 21 passed initially, one initial `page.goto` timed out under the review harness's 10-second timeout; that exact 5,000-row case passed when rerun with the ordinary 30-second timeout |
| Additional import probes | Both findings above reproduced; workspace overwrite also reproduced with the compiled Rust database |

Browser checks used the existing TypeScript test callbacks transpiled **in memory**, real Playwright Chromium/expect, and an isolated Vite test server. This was a sequential review harness, not a claimed stock `npm run test:e2e` execution. Existing case names/assertions were unchanged; the attachment callback was a no-op. The initial adversarial probe used port 5173; subsequent tests used strict port 15104. **Port 1420 was never used.** All review browser/server processes and temporary native-probe artifacts were closed/removed.

### Checked areas without additional findings

- `hidden_stories` requires an explicit existing profile, uses a parameterized profile-scoped retained-state join, and bypasses ordinary ranking/caps. Persistence, Saved/Read/group preservation, retained overflow, pruning and profile isolation are exercised by the passing Rust tests.
- `hidden_stories` and `workspace_get` are both excluded from `changed()`. Reads cannot create their own event/reload loop.
- Ordinary CAS conflicts re-read/reapply only the intent; old-profile writes remain targeted to their captured profile. Same-renderer import cancels held workspace pre-reads. These passing cases do **not** cover finding 1.
- Recovery readback failures remain explicit; duplicate restores remain disabled until confirmation. Existing pre-ack read, late profile/tab response, last-page clamp, next/previous/empty-action focus, local-search, keyboard and bounded 5,000-row cases passed.
- `sourceEligibleAt` matches the host's later-of-backoff/minimum-interval rule for stored integer fields, 5–1440-minute clamp and 30-minute fallback. Missing legacy facts remain conservatively unknown; disabled failures do not inflate the count. No new source/network/AI/media request was observed from health inspection.
- Ranking detection occurs after filtering/scoring/sorting and normalizes source keys identically to the old counts map. The single-source reason condition uses the same floating-point prefix expression; full-output legacy parity and the work-count regression passed. Mixed-source behavior remains unchanged, including the documented skewed-tail cost.
- No new SQL interpolation, credentials, HTML injection sink, or automatic media/AI/network authority was found in the reviewed v0.4 implementation paths. This is not a whole-application security certification.

## Files and limitations

Created **only this report**; no production or test source edits, commits, production appdata, credentials or network services were used. Cargo/Vite generated their normal ignored build caches. No native GUI/restart, packaging, complete frontend suite or all-target lint claim is made; those remain the parent's acceptance gates.

The first isolated native-probe link attempts failed because direct `rustc` does not inherit Cargo's native library search paths (and the cache contains multiple serde_json builds). Linking the matching existing dependency plus existing x64 native libraries succeeded; the actual probe then exited 0. No dependency was installed or changed.

The workspace's referenced `.Codex/rules/common/research-capture.md` was absent. Consistent with the existing proposal's subagent handoff, any Mission Control publication belongs to the parent; this read-only task made no external post.
