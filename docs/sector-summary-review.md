# Independent combined-sector summary review

## Verdict

**No actionable permission, cancellation, profile-membership, citation, security, or misleading-claim defect was confirmed in the completed code reviewed.** This is a scoped code-review verdict, not a full release sign-off or a claim that generated facts are verified. No fixes were made.

Reviewed against `.hermes/plans/sector-summaries.md`. Read `graphify-out/GRAPH_REPORT.md` before source discovery; its recorded commit matches current HEAD `a85405469939361f2512266ee3f4b21240ac7e8e`. The feature files are untracked in the current working tree, so the commit identifier alone does not identify this reviewed implementation.

Excluded the concurrently edited App/model daily-input helpers and LiveDiscussion integration. Those workers' changes need their own review. No competing frontend server was started.

## Contract and boundary checks

| Requirement | Reviewed implementation / outcome |
| --- | --- |
| Preview API and exact response fields | `src-tauri/src/lib.rs:246-251`, `src-tauri/src/sector_summary.rs:89-153`, and `src/types.ts:112-135` agree with the planned request and response shape. Preview has source metadata, not excerpt bodies, and never enters the provider transport. |
| Select displayed profile/day sector inputs only | `src-tauri/src/sector_summary.rs:97-145` reuses `daily_brief`; `src-tauri/src/db.rs:1046-1058` supplies the selected profile's retained day and preferences; `src-tauri/src/briefing.rs:203-258` filters profile membership, publication date and future timestamps before representative selection. No renderer-selected body or synthetic permission shortcut was found. |
| Source and article permission | `src-tauri/src/sector_summary.rs:126-135` separately requires enabled/excerpt/AI policy, item permission and `authorize_ai`. `src-tauri/src/db.rs:443-460,501-549` checks exact current input and trusted provenance or custom attestation. |
| Stale preview / changed-and-restored inputs | `src-tauri/src/sector_summary.rs:146` fingerprints sector selection, source/input revisions, profile preferences, providers and the ephemeral database input generation. `src-tauri/src/lib.rs:481-491,550-563` rejects mismatches. Host mutations cancel pending jobs; feed-content ABA is additionally covered by input generation. |
| Poll, fallback and final-delivery gates | `src-tauri/src/lib.rs:500-546` holds the summary/source-policy gates around each provider poll, reselects before and after ready delivery, and validates again before returning. `src-tauri/src/lib.rs:377-442,782-809` coordinates import, source/provider/profile/membership and refresh mutations. |
| Cancel / drop cleanup | `src-tauri/src/lib.rs:114-132,365-375,495-529` uses RAII registration cleanup and a shared cancellation flag. `src/SectorSummary.tsx:19-26,38,61-67` invalidates its request identity before asking the host to cancel and ignores late results. |
| Consent and fallback | `src-tauri/src/services.rs:84-91,332-367,471-516` reuses enabled-and-consented provider selection, fixed destinations, bounded attempts and cancellation. `src/SectorSummary.tsx:93` explicitly discloses fallback. No implicit cloud provider was found. |
| Citation validation / credential echo | `src-tauri/src/sector_summary.rs:15-58` enforces bounded JSON, exact object fields, nonempty known citation IDs, duplicate rejection and text restrictions. `src-tauri/src/services.rs:148-168,248-300` checks credential echo before and after nested JSON unescaping. Reviewed error paths do not return provider bodies or request credentials. |
| Trusted clickable sources | `src-tauri/src/sector_summary.rs:136-143` supplies canonical host-owned originals. `src/SectorSummary.tsx:113-118` resolves IDs against host sources rather than using a model URL; `src/SourceUrl.tsx:1-5` uses native navigation, not a renderer href. Generated prose is React text, not interpreted HTML/Markdown. |
| Result API / ephemeral output | `src-tauri/src/lib.rs:539-547` and `src/types.ts:136-147` agree with the planned result. The provider result is validated and assembled in memory; no sector-generated text is persisted. The existing host regression checks that export does not contain it. |
| Frontend identity and disclosure | `src/Briefing.tsx:18,24-28,57` hides a mismatched brief and remounts sector state for supplied identity/provider changes. `src/SectorSummary.tsx:41-45` refuses mismatched deliveries. Lines 95-100 and 110-123 disclose bounded input, excerpt/headline scope, agency notices and unverified AI. Citation validity is explicitly not factual verification. |

`eligibleCount` and `selectedCount` currently coincide: eligibility is evaluated over the already capped displayed representative set. This matches the plan's displayed-item selection; coverage explicitly reports retained sector articles and the representative sample. The browser fixture's scenario with additional eligible-but-unselected inputs exercises a defensive UI branch, not a separate backend sampling policy.

## Fresh regression execution

All commands ran from `C:/Users/user/Documents/News Terminal`, using existing tests and without modifying implementation or test sources.

| Command | Actual result |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml sector -- --nocapture` | 11 library tests, 2 briefing tests and 4 sector integration tests passed; no failures. Other binaries had no filter matches. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test sector_summary` | 5 passed; actual local-Qwen test ignored as declared; no failures. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib fallback` | 4 passed, including provider consent/order and revoked/refreshed input fallback prevention; one filter match is an unrelated media fallback test. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib cancellation` | 2 passed: no polling after prior cancellation and dropping an in-flight response body. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test briefing` | 9 passed, including profile filters, hidden state, day selection and retained entries beyond the snapshot window. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test briefing_calendar` | 6 passed, including DST, skipped dates and exact day-boundary behavior. |

Runs overlap; these rows are not an aggregate unique-test count.

## Residual verification limits (not confirmed defects)

- Browser sector regressions were inspected in `tests/e2e/sector-summary.spec.ts`, but not rerun here. The checked-in Playwright config starts its own non-reusable server (`playwright.config.ts:11-15`), conflicting with the requested no-competing-server scope. Previously reported browser success is not fresh reviewer execution.
- App snapshot/input-revision computation is deliberately excluded while another worker edits it. The Briefing component correctly reacts to its supplied revision; this review does not establish that every upstream change always produces that revision.
- Cancellation unit tests establish dropping client-side work and rejecting delivery. They do not prove that a remote provider stops compute after an HTTP client disconnects; do not describe cancellation as guaranteed remote-compute termination.
- No actual model, native WebView, factual-entailment evaluation, full-suite gate, Clippy rerun, version bump or installer verification was performed by this reviewer. These remain parent/release acceptance work. The local-model integration test stayed ignored.
- The specified research-capture rule file `C:/Users/user/.Codex/rules/common/research-capture.md` was unavailable, and a filename search under `C:/Users/user/Documents/Codex` found no replacement. No Mission Control report was posted; no command or destination was guessed.

## Files changed

Only `docs/sector-summary-review.md` was created by this review. No implementation fixes, test edits, commits or configuration changes were made.
