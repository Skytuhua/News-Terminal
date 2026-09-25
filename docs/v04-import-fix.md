# v0.4 import-isolation correction

## Outcome

Both findings in `v04-independent-review.md` are corrected with one host-owned replacement identity and an explicit cross-window replacement notification. No release executable or installer was built, no package/version/lockfile was changed, and no commit was made. Native acceptance against a newly built executable remains the parent's next gate; the old binary's smoke result does not cover this correction.

## Authoritative contract

`Database` now owns an in-memory UUID `replacement_token`. It is initialized at open and replaced only after a successful import transaction commits. It is independent of the existing content/AI generation and workspace revision, not serialized into a backup, and not a source/AI/media permission grant.

- `snapshot` adds top-level `replacementToken:string`; its nested `workspace` retains the durable shape.
- `workspace_get` returns the existing workspace fields plus `replacementToken:string`, without reading articles or changing the database.
- `workspace_save`, every `article_state` variant, and `group_split` **require a matching top-level token** in `Database::request`. Missing/null/wrong-type/empty/old/forged tokens fail closed. The token check and mutation use the same exclusive database access as import. Workspace revision CAS still runs after the token check.
- Replacement rejection is `Database replaced: reload before making a new change`, deliberately distinct from ordinary revision conflicts. A matching imported revision cannot authorize a pre-import request.
- The nested transport token from `workspace_get` is removed before storing a workspace; it does not replace the mandatory top-level token. Backup validation still rejects unknown workspace fields, including an injected replacement token.
- `import` still returns `null`; `hidden_stories` still returns `Article[]`; native window context and backup schema are unchanged.

This is an intentional required-write wire change. Tokenless legacy mutation callers are not silently accepted. `docs/IPC-CONTRACT.md` contains the exact request/response contract and migration example.

## Renderer and native boundary

After a committed import, Tauri dispatch reconciles native ownership and emits `database-replaced` to all windows, including survivors with unchanged profile/tab IDs. The event is emitted even when reconciliation returned an error; that error is then propagated. Normal mutation `data-changed` remains separate.

`subscribe` installs replacement and ordinary-change listeners, with cleanup for both. The initial renderer read starts after listener registration. `App` uses the same invalidation routine for local imports and remote replacement events:

- advance continuation/workspace/read epochs and discard old debounce timers and queued intents;
- clear Undo, pending acknowledgements, selection, search results and old reading content;
- replace the snapshot read coordinator rather than waiting behind an old read; obsolete coordinator callbacks cannot start another authoritative read;
- reset profile/context adoption, load the authoritative replacement, and remount Hidden recovery;
- preserve the Settings dialog while removing its old reading surfaces, so import completion/failure remains observable;
- read back the original/current database if import is rejected, rather than leaving an unusable blank workspace.

Workspace intents pin the token from the originating visible snapshot. Every workspace-only pre-read, including the ordinary CAS retry, must match that same token. A new database token cancels the intent; it is never substituted onto the old intent. Host rejection protects saves already dispatched before notification delivery. Hidden Restore captures its mounted snapshot's token before dispatch; current-component checks additionally suppress late acknowledgements and old reads. Main reading state writes and comparison group splitting also carry their originating snapshot token.

Existing local workspace queue draining is retained for compatibility. It is not the security boundary: database validation also protects remote windows and Restore operations outside that queue.

## Observed RED → GREEN sequence

The primary regressions were run sequentially, not merely added after a green implementation:

1. **Rust same-revision workspace ABA:** a revision-zero workspace read, import with the same profile/tab IDs and an extra imported tab, then the original save. RED accepted the obsolete save and failed `pre-import workspace must not overwrite the replacement`; GREEN rejects it without changing exported state and accepts a newly observed token.
2. **Browser remote held workspace getter:** Science intent held after `workspace_get`, external fixture-host import with identical IDs/revision zero and an extra tab, then release. RED lost Imported tab after release; GREEN retains both imported tabs and sends no obsolete save.
3. **Rust before-execution Restore:** capture the old Restore request, import the same article/profile IDs as hidden, then execute it. RED changed replacement hidden state; GREEN rejects it. An explicit current-token Restore still preserves Saved and Read.
4. **Browser local before-execution Restore:** hold `article_state` before fixture execution, import through the real Settings UI, observe imported hidden content, then release. After correcting a Settings-unmount regression, the decisive RED was authoritative `hidden:false` instead of `true`; GREEN leaves the replacement hidden until a new explicit Restore.
5. **Browser remote held Hidden read:** with replacement invalidation temporarily disabled, RED retained Original hidden while the imported store contained replacement content. Restoring the boundary made it GREEN. The final test also holds the replacement snapshot: old content must disappear while that snapshot is held, and imported content must render while the old Hidden response is still held. It runs for both main and surviving detached contexts.
6. **Rejected-import recovery:** the new invalidation exposed an unusable blank workspace after a failed import. RED reproduced it; GREEN re-reads authoritative state and allows a subsequent Science action.

The browser fixture mirrors the mandatory host token guard and replacement event. Its before-execution and after-execution hooks remain distinct. Rust tests independently exercise real `Database` and `Backend` behavior, not fixture-only enforcement.

Additional coverage:

- a oneshot barrier holds pre-import article-state, workspace-save and group-split requests until after `Backend::execute(import)`;
- tokenless/malformed requests, nested-token-only bypass attempts, failed imports, ordinary mutations, reopen identity, and backup injection/non-serialization;
- already-dispatched workspace save with replacement notification deliberately suppressed;
- import during the pre-read of an ordinary revision-conflict retry, also before replacement notification delivery;
- retained original delayed-ack Hide, Undo and Hidden Restore cases, profile/tab scope, revision conflicts, source rights, AI/media revocation and native ownership tests.

The old coalesced-read test's pre-release snapshot assertion changed from zero to one because holding replacement readback behind an obsolete read is now explicitly forbidden. It now requires `Backup imported.` **before** releasing the old snapshot and retains the exact final one-read count and imported-state assertions. Existing workspace roundtrip tests compare durable workspace fields separately from the ephemeral token; negative validation tests supply a current token so they still reach the original validation/CAS failure. No security assertion or ordinary CAS expectation was removed.

## Final executed verification

| Command/check | Result |
|---|---|
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml` | **215 passed, 15 explicitly ignored, zero failures**, including all 6 ranking tests and 4 new import-isolation tests |
| `cargo clippy --offline --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Passed |
| `npm test` | **13 passed**, 4 files |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Vite production frontend generated |
| `npm run test:e2e -- --workers=1` | **159 passed**, stock Playwright runner, sequential worker |
| `node --check` on the five migrated scripts below | Passed |

Ignored Rust cases remain the pre-existing explicit live-network/local-model/keyring tests; they were not enabled. Browser tests used the existing Playwright config and its owned Vite test server (`reuseExistingServer:false`), not a callback-transpilation substitute. An attempted extra config under `.hermes` was blocked by the protected-path approval guard and was not retried; the existing stock runner worked. No new dependency, production appdata, feed fetch, local-model request, credential mutation, release build, packaging, or commit was required.

## Files and native handoff

Production:
- `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`
- `src/App.tsx`, `src/HiddenStories.tsx`, `src/ipc.ts`, `src/types.ts`

Tests:
- new `src-tauri/tests/import_isolation.rs`, new `tests/e2e/import-isolation.spec.ts`
- `src-tauri/tests/backend.rs`, `backend_limits.rs`, `backend_media.rs`, `briefing.rs`, `host/sector.rs`, `sector_summary.rs`
- `tests/e2e/fixture.ts`, `hidden-stories.spec.ts`, `daily-recovery.spec.ts`

Compatibility scripts:
- `scripts/native-smoke.mjs`, `scripts/v02-native-monitors.mjs`, `scripts/sector-native-smoke.mjs`: explicit originating-snapshot tokens on guarded writes.
- `scripts/v04-native-smoke.mjs`: narrow-get parity now checks token equality separately from durable workspace equality; exact Restore request assertion includes the required token.
- `scripts/daily-performance-probe.mjs`: measurement fixture supports `workspace_get`, issues the snapshot token and enforces required guarded-write tokens.

Documentation: `docs/IPC-CONTRACT.md` and this report.

**Remaining gate:** rebuild the native executable in the parent workflow, then re-run `scripts/v04-native-smoke.mjs` and the required native/restart acceptance. Scripts were syntax-checked here, not executed against the old binary. The actual Windows IPC scheduler was not artificially delayed; deterministic browser barriers plus real Rust database/host barriers establish the tested interleavings.
