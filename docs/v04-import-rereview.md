# v0.4 import-isolation independent re-review

## Verdict

**Scoped no findings: neither original import-isolation defect remains in the reviewed implementation. No additional actionable defect was found in the token, CAS-retry, replacement-event, held-read, or rejected-import paths reviewed below.** This clears the two findings for the parent's remaining acceptance/packaging workflow; it is not a native release or whole-application certification.

Read `graphify-out/GRAPH_REPORT.md` first, followed by `docs/v04-independent-review.md`, `docs/v04-import-fix.md`, and the actual Rust/renderer/fixture/regression implementations. Checkout HEAD remains `a85405469939361f2512266ee3f4b21240ac7e8e`; the application files are untracked, so this verdict concerns current file contents, not a committed diff. The global graph index was absent; the repository graph was available.

## Finding 1: cross-window workspace ABA and held recovery reads

**Resolved within the reviewed scope.**

- **Authoritative token, not renderer-only protection:** `src-tauri/src/db.rs:1048–1052,1105–1131` requires the exact current top-level string token before workspace validation/CAS/write. Missing, null, non-string, empty and stale/forged values cannot pass equality with the host UUID. A nested token cannot replace the required top-level token. The nested transport field is stripped before persistence. Workspace revisions remain a separate, required CAS check.
- **Commit boundary:** `db.rs:827–900` validates before beginning replacement, executes COMMIT/ROLLBACK with error propagation, and only then rotates the replacement UUID on success. Ordinary writes and failed validation do not rotate it. `Database` initializes a new UUID on open; export does not carry it. A COMMIT error returns before rotation. This last error-path statement is source inspection, not a disk/COMMIT-failure injection result.
- **No host dispatch bypass found:** guarded operations reach `Database::request` under `Backend::database()`'s exclusive mutex (`src-tauri/src/lib.rs:152–156,377–399,434–458`). Both import and mutation execute their database work within that lock; validation and mutation cannot straddle another import. Native dispatch does not intercept these guarded database operations.
- **Original-token retry:** `src/App.tsx:312–347` captures the originating snapshot token outside the queue and outside the retry loop. Both initial `workspace_get` and CAS retry must match that captured token. It is never refreshed onto an old intent. An already-dispatched old save remains protected by the host guard. The replacement error deliberately does not match the ordinary revision/stale/conflict retry classifier.
- **Surviving windows are notified:** `lib.rs:872–881` emits `database-replaced` after successful backend import, including when native reconciliation subsequently returns an error. This is an app-wide event, not restricted to windows that native reconciliation removes. A backend import failure returns before this event. Ordinary `data-changed` remains separate.
- **Read invalidation is immediate:** `src/ipc.ts:25–38` registers replacement before ordinary-change listeners and cleans up both; App starts its initial read after registration. `App.tsx:193–267` advances continuation/read generations, replaces the coalescing coordinator, clears old queue/debounce/UI state, resets context adoption and requests authoritative replacement state. Obsolete coordinator callbacks cannot initiate a fresh authoritative read. This avoids waiting behind an old snapshot response.
- **Hidden recovery is remounted, not merely refreshed:** `App.tsx:1043` keys recovery by the incremented epoch and excludes it while invalid/loading; `src/HiddenStories.tsx:7–9,37–65` suppresses obsolete read completion with liveness/current-token checks. The replacement content can therefore be read by a new component while an old collection read remains held.

Reviewed `tests/e2e/import-isolation.spec.ts` and its actual fixture hooks: it covers remote same-ID/revision held getters, an already-dispatched save with replacement notification suppressed, import during ordinary CAS retry, and held Hidden reads for both main and detached contexts. These browser cases were **inspected, not independently executed in this re-review**.

## Finding 2: Restore delayed before host execution

**Resolved within the reviewed scope.**

- `HiddenStories.tsx:67–81` includes the mounted snapshot's replacement token in the Restore request before awaiting dispatch. It does not substitute a new token after an import.
- `db.rs:1222–1247` places the same mandatory guard before all `article_state` variants and `group_split`, not only `hidden:false`. Consequently a stale Restore cannot change imported state even if the renderer has not received the event yet. Saved/Read mutations do not gain a tokenless alternate branch.
- Main reading mutations and comparison splitting pass through the token-bearing `App.action` (`App.tsx:293–310`). Renderer generation checks additionally suppress old acknowledgement/readback continuations; those checks supplement, rather than replace, host enforcement.
- The before-execution browser regression is genuinely distinct from an after-execution delayed acknowledgement: the fixture awaits `__TEST_BEFORE_DISPATCH__` before checking the token or mutating state. Its replacement import generates a new host-fixture token, rather than trusting a backup token (`tests/e2e/fixture.ts:141–145,247–259,367–378`). The regression subsequently attempts a fresh explicit Restore, so rejection does not imply permanent inability to restore.

## Failed-import behavior

`App.importBackup` invalidates before dispatch, but its rejection branch reads authoritative state back before rethrowing the import error (`App.tsx:249–267`). The Settings dialog stays mounted while old reading surfaces are removed, and `Settings.tsx:91–109` displays failure rather than success. The `finally` branch clears importing state and advances the recovery epoch. Thus ordinary invalid/rejected imports restore the original usable workspace rather than leaving the new blank invalidation shell. If authoritative readback itself fails, an error/invalid state remains instead of claiming successful recovery; this review does not claim recovery despite unavailable reads.

The actual Rust tests verify unchanged token after rejected import, non-serialization/backup injection rejection, changed token after successful import/reopen, and rejection of delayed writes without changing exported replacement state. The failed-import UI regression was inspected, not browser-run here.

## Fresh execution evidence

All commands ran against this checkout and exited zero:

| Command | Observed result |
|---|---|
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test import_isolation` | 4 passed, 0 failed; actual Database and Backend tests |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib read_only_for_change_events` | 2 passed, 0 failed; workspace/Hidden reads remain event-read-only |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test backend import` | 4 passed, 0 failed; import validation/atomicity, revision validation, getter parity across CAS/reopen/import |

The import-isolation executable covers same-revision workspace ABA, delayed Restore before execution, malformed/missing/token-lifetime cases, and a real Backend oneshot barrier that releases old article/workspace/group requests only after import. These are real Rust results, not inferred from the browser fixture or copied from the fix report. No red/green rerun or broader full-suite result is claimed here.

## Scope, files and remaining gates

- Created only `docs/v04-import-rereview.md`. No source, test, version, package, lockfile or build-script edits; no commit. Cargo used normal ignored build artifacts and test-local databases.
- No browser/server/native GUI was started; **port 1420 was not used**. Browser execution, rebuilt-native import/event/restart acceptance and final packaging remain with the parent. Previously reported full-suite results were not substituted for fresh execution here.
- This is limited to the two original findings and their replacement-token/event/readback correction. It does not assert that every unrelated settings mutation is import-generation-guarded, or that event transport/disk failure was experimentally fault-injected.
- The referenced `C:/Users/user/.Codex/rules/common/research-capture.md` was absent. No external publication was attempted in this report-only subagent task; any research-panel handoff remains with the parent.
