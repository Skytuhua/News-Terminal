# v0.2 backend / briefing / media review

Read-only application review; no fixes applied. Findings below are independent of the pending catalog/source-policy and native/frontend work. **This is not release verification.**

## Scope and evidence

Reviewed `src-tauri/src/{lib,media,services,briefing,db}.rs`, `src-tauri/src/db/backup.rs`, relevant intelligence helpers and backend/media/briefing/host tests. Read `graphify-out/GRAPH_REPORT.md` first; its commit matches HEAD `a85405469939361f2512266ee3f4b21240ac7e8e`. Application files are predominantly untracked, so HEAD is not a snapshot of the implementation reviewed. Line references below identify the files read during this review, not the Git commit's contents.

Evidence labels:
- **Code-path finding:** direct control-flow/data-flow inspection, with a precise reproduction and proposed regression below. No new Rust test was compiled or added under this read-only assignment.
- **Executed supporting probe:** actual read-only Python execution for JSON envelope sizes and timezone behavior; these are not substitutes for running the proposed Rust integration regressions.
- Existing compiled test executables were rerun, without rebuilding. Their success does not establish that every concurrent source edit has been compiled.

## Findings

### R1 — P1: Media requests have no host-wide concurrency or byte budget

**Locations:** `src-tauri/src/lib.rs:28-32,90-105`; `src-tauri/src/media.rs:126-133`.

`media_load` clones the permitted stored item, releases the database lock, and independently awaits a download. Unlike summaries (four registered jobs) and refresh (four buffered jobs), media has no semaphore, registration count, duplicate-request coalescing, or shared in-flight byte budget. The `< 8` index check limits which attachment can be selected, not the number of loads. Repeated loads of index zero are unrestricted, including across windows.

Each accepted video may retain a 32 MiB body while allocating its base64 string and another formatted data-URL string. An executed arithmetic probe gives 44,739,244 base64 bytes and approximately 117.33 MiB for those three payload buffers at the encoding point, excluding allocator/IPC/WebView copies. This is a per-load peak estimate, not measured process RSS. Returned data URLs alone are also large and can coexist across completed calls.

**Reproduction:** Store one permitted inline MP4 item whose HTTPS server returns a valid MP4 near 32 MiB. Issue multiple concurrent `Backend::execute({op:"media_load", articleId, index:0})` calls, including identical IDs/indexes. Hold response bodies behind a barrier: every call can reach the server; none is rejected for saturation. Release the bodies together and observe allocations/returned payloads. No malicious decoder or SSRF bypass is needed.

**Minimal regression/fix direction:** Add a host media-loader injection point and a bounded permit with RAII release. A fake blocked loader should prove the next call is rejected or waits *before* starting another transfer; test permit release on success, error and cancellation. Choose the concurrency/byte budget explicitly. Avoid treating frontend button disabling as the backend limit.

**Evidence:** Code-path finding; payload arithmetic executed. A live memory-pressure test was deliberately not run.

### R2 — P1: Media revocation and import do not invalidate an already-authorized media load

**Locations:** `src-tauri/src/lib.rs:94-105,200-208,234-236`; `src-tauri/src/db.rs:912-928`; `src-tauri/src/media.rs:71-87,109-134`.

Authorization is checked only before the asynchronous load. `source_update` can revoke `mediaAllowed` and remove every stored media reference, but there is no cancellation signal or final policy/revision check for an outstanding `media_load`. Import excludes refreshes and cancels summaries only; it can replace/delete the source/article while the old media load continues and returns old bytes. This is separate from the already-addressed refresh/import attribution race.

**Reproduction:** Start loading a permitted stored item and pause its response. In another command, successfully execute `source_update` with `mediaAllowed:false`; verify the article no longer has `media`. Release the response. The old command still returns a data URL. Repeat with a successful import of a backup omitting/replacing that article/source. For a stricter race, pause DNS before the connection: revocation can complete before the old request starts transferring media.

**Impact:** Revocation removes local metadata but does not stop the outstanding transfer or prevent delivery after revocation/import. An imported workspace can receive a result authorized against the previous database contents. This does not claim bytes already transmitted can be recalled.

**Minimal regression/fix direction:** Use a shared media registration/policy-generation gate, cancel affected jobs on revocation/import, and reject a stale result. Cover both revocation and import with a blocked injected loader. Do not hold the SQLite mutex across network I/O.

**Evidence:** Code-path finding. Existing media tests exercise initial permission/storage state, not this host interleaving.

### R3 — P1: A delayed local-AI connection can undo a newer consent revocation or import

**Locations:** `src-tauri/src/lib.rs:107-130,200-220`; `src-tauri/src/db.rs:596-601`.

`local_ai_connect` performs `/api/tags` asynchronously, then unconditionally persists `enabled:true, consented:true`. It neither registers a cancellable connection operation before the await nor records the provider/import revision. Acquiring the summary gate only at the final write serializes writes but cannot distinguish a stale connection attempt from current user intent.

**Reproduction:** Start `local_ai_connect` while the loopback `/api/tags` response is delayed. Before the response completes, successfully save the Ollama provider with both consent and enablement false, or import a valid backup (which intentionally disables all providers). Then complete the earlier tags response with `models:[{name:"qwen3:4b-instruct-2507-q4_K_M"}]`. The older operation writes both booleans back to true. Read back `snapshot.providers` to demonstrate the overwritten consent state. The race needs only an ordinary slow local server; the endpoint remains fixed loopback.

**Minimal regression/fix direction:** Capture a provider/consent generation when the connect action starts, and commit only if still current; invalidate it on import/provider changes. Add a delayed-tags injection regression for revoke and import. This is not a request to generalize the local endpoint or add secrets.

**Evidence:** Code-path finding; no process was bound to the user's Ollama port for this review.

### R4 — P2: A valid exported backup can be rejected by the host import envelope limit

**Locations:** `src-tauri/src/lib.rs:83-85`; `src-tauri/src/db/backup.rs:35-39`; `src-tauri/src/db.rs:586-589`.

The exporter validates the *raw* backup JSON against 32 MiB, but `Backend::execute` limits `request.to_string()` to 34 MiB. An import embeds the backup as a JSON **string**, so quotes and backslashes in the already-serialized backup are escaped again. The two-megabyte allowance does not cover this expansion. Therefore successful `Database::export()` plus `Database::import()` validation does not guarantee restoration through the real host command.

**Executed supporting probe:** A compact JSON payload containing 5,000 article records with permitted 2,000-character excerpts consisting of quotation marks measured:

```text
raw backup skeleton: 21,836,735 bytes   (< 33,554,432-byte raw limit)
import envelope:     42,156,770 bytes   (> 35,651,584-byte host limit)
```

The probe's skeleton intentionally omitted required documents; it demonstrates exact ASCII JSON escaping and size, not validator acceptance. Adding ordinary required documents leaves substantial margin on both sides. Quotation marks survive the feed plaintext sanitizer.

**Production reproduction/regression:** Create an in-memory DB and an excerpt-permitted custom source through normal requests. Ingest ten batches of 500 distinct article URLs, each with a 2,000-quote excerpt. Export; assert `Database::memory().import(&backup)` succeeds. Move the original DB into `Backend`, then execute `{op:"import", data:backup}`. It fails with `Request exceeds size limit`, before backup validation. Keep this as a host-level regression rather than another DB-only roundtrip test.

**Minimal fix direction:** Apply the import data limit to the decoded string with separately bounded envelope fields, or choose a host-envelope ceiling that accounts for worst-case valid JSON escaping. Avoid removing limits entirely.

**Evidence:** Code-path finding plus executed serialization-size probe. Full Rust regression remains to be run by the owner.

### R5 — P2: Calendar reports fail on real DST transitions at midnight, including the preceding day

**Location:** `src-tauri/src/briefing.rs:26-38`.

Resolving each midnight independently correctly handles common 23/25-hour days, but it assumes both midnights exist. Some supported local timezones advance directly from the preceding day's 23:59 to 01:00. `earliest()` returns `None` for the missing midnight and the whole report errors, although the calendar date has valid hours. The preceding date also fails because its end boundary uses that same nonexistent midnight.

**Concrete reproduction:** Resolve `2026-09-06` in `America/Santiago`; midnight is skipped. Request both `2026-09-05` and `2026-09-06`. Current `bounds_in_timezone` rejects a boundary for each. A read-only Python `zoneinfo` probe confirmed that neither proposed midnight offset roundtrips:

```text
2026-09-06T00:00:00-04:00 -> 2026-09-06T01:00:00-03:00
2026-09-06T00:00:00-03:00 -> 2026-09-05T23:00:00-04:00
```

The official Chrono documentation explicitly states that `LocalResult::earliest` returns `None` for a gap: https://docs.rs/chrono/latest/chrono/offset/enum.LocalResult.html . This documentation was retrieved directly during review.

**Minimal regression/fix direction:** Extend the existing deterministic timezone fixture (no global OS timezone mutation) with a midnight gap; assert both adjacent dates produce correct half-open boundaries and include all real times belonging to that local date. Resolve a date's first valid local instant instead of insisting on 00:00; explicitly define behavior for an entirely skipped calendar date. Existing Pacific fixtures transition at 02:00 and do not cover this.

**Evidence:** Code-path finding, actual timezone probe, and official API contract. The Rust midnight-gap regression is proposed, not reported passing/failing.

### R6 — P2: Disabling a source does not stop queued refresh work from starting later

**Locations:** `src-tauri/src/lib.rs:254-267`; `src-tauri/src/services.rs:503-505`; `src-tauri/src/db.rs:218-220,904-908`.

Refresh snapshots all due sources and buffers four requests. A later `source_update(enabled:false)` modifies only the database. Jobs beyond the first four still carry `enabled:true` from the old snapshot; once a slot opens, `fetch_feed` checks that stale value and begins a new request. `ingest` reloads the source but does not reject a disabled one, so results are committed too. This is not merely allowing an already-transmitted request to finish.

**Reproduction:** Create at least five due sources. Block the first four fetches in `refresh_using`; identify and disable a source still queued beyond those four. Complete one blocked fetch. The disabled source's fetch closure is subsequently polled, and its returned article is ingested. The source policy explicitly says disabling a source stops refresh (`docs/source-policy.md:7,12`).

**Minimal regression/fix direction:** Before starting a queued transfer, verify current enablement under a registration/generation gate; prevent stale work from committing after disable. Add a deterministic host regression using the existing `refresh_using` injection seam and a counter/Notify barrier. Revalidate without holding the DB mutex across awaits.

**Evidence:** Code-path finding. Existing host refresh/import coverage addresses import exclusion, not source-disable interleavings.

## Areas checked without a new finding

- **SSRF:** Inspected HTTPS/443 and credential restrictions; literal-IP filtering; rejecting an entire mixed public/private DNS answer; pinning resolved addresses; no proxies; media redirects rejected; bounded DNS/request/body timing. No concrete new server-side SSRF bypass found in the reviewed media path. This is not a general network-security certification.
- **Source attribution/import:** Ingestion derives source fields from the DB; refresh/import exclusion already has a targeted host test, rerun successfully. Pending authoritative catalog/import permission handling was deliberately not treated as completed work or duplicated as a new finding. R2 concerns media results outside that refresh guard.
- **Counts:** Profile filtering, hidden-state overlay, saved stories not bypassing briefing filters, half-open day bounds, future-publication exclusion, separate undated first-seen count, original counts before representative grouping, overlapping multi-topic counts, and historical queries beyond the snapshot window are directly represented in the reviewed code/tests. No additional count defect identified beyond R5's date-boundary failure.
- **Backup:** Checked transaction rollback structure, permission/media validation, provider reset on import, and export's validator call. R4 is specifically a host-envelope mismatch missed by DB-only tests.

## Actual commands/results from this review

Executed existing binaries from the repository root, without compilation or application-file changes:

```text
src-tauri/target/debug/deps/briefing-eeb6692780c90d16.exe --nocapture
  9 passed; 0 failed
src-tauri/target/debug/deps/briefing_calendar-42fe4b036318824f.exe --nocapture
  2 passed; 0 failed
src-tauri/target/debug/media-isolated-tests.exe media::tests --nocapture
  8 passed; 0 failed; 1 ignored (live NASA)
src-tauri/target/debug/media-isolated-tests.exe services:: --nocapture
  25 passed; 0 failed; 3 ignored (live USGS, port-11434 fixture, keyring write)
src-tauri/target/debug/deps/news_terminal_lib-09faff3c4f9e9ccb.exe host_tests --nocapture
  4 passed; 0 failed
src-tauri/target/debug/deps/v02_host-ba1f97a6a5cc986e.exe --skip connect_actual_local_ai --nocapture
  1 passed; 0 failed; actual-local-AI test filtered out
```

The newly proposed regressions were not added/executed. Existing success does not refute the uncovered interleavings. Native/live/frontend completion, final catalog state, playable-media decoding and packaged release behavior were not reviewed or certified.

## Files and blockers

- Only file created by this assignment: `docs/v02-review-backend.md`.
- No app files changed; no formatter, Cargo rebuild, live media download, keyring operation, Ollama fixture, import into user data, or release action performed.
- Global graph index was absent; repository-local graph report was used.
- The supplied Mission Control capture instructions path `C:/Users/user/.Codex/rules/common/research-capture.md` was absent. No capture command was guessed or external report posted; the assigned report is the delivered artifact.
- The configured extraction backend could not extract the official Chrono URL; direct read-only HTTPS retrieval succeeded instead.
