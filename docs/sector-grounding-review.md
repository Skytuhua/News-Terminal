# Independent exact-quotation grounding review

## Verdict

**No actionable security or correctness defect confirmed in the exact-quotation grounding change.** This verdict concerns the supplied-input quotation contract, not truth, factual entailment, completeness, source reliability, or model usefulness. No application or test-source fixes were made.

Read `graphify-out/GRAPH_REPORT.md` before source discovery, then `docs/sector-grounding.md`, the sector validator/selection/prompt builder, provider response handling, final host delivery, relevant rights/native-navigation boundaries, `SectorSummary`, types, Briefing identity handling, and scoped tests. The graph and HEAD identify `a85405469939361f2512266ee3f4b21240ac7e8e`, but feature files are untracked; the hashes below identify the reviewed implementation more precisely. App/input-revision and LiveDiscussion workers remain outside this review.

## Concrete bypass checks

| Boundary | Observed result |
| --- | --- |
| Unicode/numeric fragments | An isolated Rust executable compiled the actual `validate_bullets` and `plain_text` function bodies extracted unchanged from production. It rejected ASCII, Arabic-Indic and fullwidth numeric suffixes; Unicode minus/nonbreaking-hyphen removal; fullwidth decimal clipping; combining-mark, zero-width-space, word-joiner and bidi-mark pseudo-boundaries; and removal of a Unicode percent suffix. Unicode whitespace normalization and complete Unicode quotations passed as intended. |
| Wrong-source evidence | Exact AL90 text attributed to S2 failed. A citation/evidence source disagreement failed. Existing tests also rejected the captured unsupported weather output, 48→36 rewrites, same-source fabricated Fay attribution, missing/extra evidence, and invalid later bullets without returning a valid subset. |
| Prompt/source boundary | Outside-the-2,000-character excerpt content, spliced passages, HTML/control-text mismatches and source metadata used as evidence were rejected. Existing tests confirm `prompt()` and `inputs()` produce the same sanitized bounded evidence map. The host validates against that map, not raw preview titles. |
| Credential escape | Fresh sector transport regression rejected a JSON `\u0066`-escaped synthetic credential even when the decoded credential was present in fixture evidence. The additional shared-response regression rejected HTML-entity-encoded credentials; error strings did not echo them. `services.rs:154-168` checks decoded bullet text after nested JSON parsing, supplementing `response_text`'s raw/entity check. Exact `text === quote` makes checking text sufficient for the accepted evidence value. No actual credentials were accessed. |
| Unsafe links / active content | Exact source text containing `https://…`, Markdown links, raw HTML and controls was rejected. Host canonical-link regression rejected script/file schemes, URL credentials, local/private literals, local hostnames, controls and oversized URLs. Citation clicks resolve host-owned source IDs; React renders quotations as text, not HTML/Markdown. No source URL is fetched by quotation validation. |
| Output truncation / limits | An over-8,192-byte structured response failed. Shared response regressions rejected provider length termination, unbounded/empty output and excessive declared body length. JSON or malformed partial bullets fail as a whole. |
| Stale validation | Fresh host tests passed content/membership/preference/provider/source/import changes before polling and at ready delivery, changed-and-restored membership/content, cancellation, dropped-job cleanup and valid unchanged-input delivery. `lib.rs:500-547` retains the original prompt inputs, rechecks current selection under host gates, then validates the delivered bullets again. |

Implementation anchors: `src-tauri/src/sector_summary.rs:15-104,150-174`; `src-tauri/src/services.rs:148-170,248-300,956-982`; `src-tauri/src/lib.rs:461-565`; `src/SectorSummary.tsx:19-58,94-127`; `src/types.ts:136-152`.

## UI wording

The reviewed renderer calls the feature **“Sector source quotations”**, says it does not combine passages into a paraphrase or verify facts, and labels results **“AI-selected source quotations · unverified.”** The host warning explicitly excludes **“factual entailment, context or truth”** and notes incomplete excerpts. Displayed passages use `<q>` and one source citation. Optional evidence in the TypeScript legacy wire type is not optional at rendering: missing/mismatched evidence causes whole-response rejection. These labels accurately describe mechanical matching rather than claiming semantic certification.

## Known limitations, not newly confirmed defects

- **Input truncation can clip an original token.** The concrete source `"x".repeat(1998) + " 60 percent."` becomes a supplied excerpt ending in `6`; a quotation of `6` is accepted. Boundaries are enforced against the **supplied sanitized/bounded input**, not the untruncated original. This is within the documented bounded-input contract, but no release claim should say original-source token completeness is guaranteed. The documentation already acknowledges incomplete/truncated inputs.
- **Selective quotation can invert context.** Selecting `Fay has 60 percent chance.` from `The claim is false: Fay has 60 percent chance.` passes. This is why quotation matching does not prove entailment. Likewise, an instruction already in a source can be displayed as inert quoted text; the review found no execution path from it.
- Source text `javascript:alert(1)` without a `://` delimiter is accepted as an exact quotation. It remains inert React text, never a generated link or navigation target. The URL denylist is not a universal natural-language URL recognizer. The native opener's scheme/credential checks are not a DNS destination guarantee; reviewed sector links additionally go through host `canonical_url` selection.
- No fresh browser/native-window run, model request, full-suite execution, Clippy, installer check or upstream App revision audit was performed. Existing browser tests were read, not rerun. Other workers' reported results are not claimed as reviewer evidence. No competing server was started.
- Tests and isolated probes establish the tested cases, not exhaustive Unicode, provider or concurrency coverage. Exact source fidelity is not factual verification.

## Fresh execution evidence

All repository commands ran from `C:/Users/user/Documents/News Terminal`.

| Command | Result |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib sector -- --nocapture` | 17 passed, 0 failed. Includes grounding, transport, and host mutation/cancellation tests. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test sector_summary` | 5 passed, 0 failed, 2 actual-model tests intentionally ignored. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib article_links_reject_private_targets_and_oversized_tokens` | 1 passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib ai_rejects_encoded_secret_truncation_and_unbounded_output` | 1 passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib ai_redirects_are_not_followed_and_errors_never_echo_body` | 1 passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib declared_response_limit_rejects_before_reading_body` | 1 passed. |
| `python C:/Users/user/AppData/Local/Temp/sector-grounding-review-probes.py` | 29 explicit probe outcomes matched expectations; exit 0. |

The temporary probe driver generated and compiled an isolated executable in `C:/Users/user/AppData/Local/Temp/sector-grounding-review-gvvrh3jc`, linking existing dependency artifacts. It did not edit repository source or duplicate the validator in another implementation language. SHA-256 of the extracted validator plus sanitizer function text: `af23dce533fcc00e1cb38a61671a640645377fac6860e7a263a8762e65ba2166`.

Reviewed file SHA-256 values:

```text
8df85917f440fac346afaaf13654ee4eeaae4ace8124ec15f3b6a4b57f5f0017  src-tauri/src/sector_summary.rs
c4f2dcd4b3e2b831de7d22abb6aedd367b4f60477cd50f83298f221bea32031e  src-tauri/src/services.rs
0f866e2bda88246c24b7ece1f100d39c6ae7f3e6a09e0fe0eb22288f25e99cdd  src-tauri/src/lib.rs
64aa2c7adfce68c6d349fc626666acc4801858ad7531cbe81c74ba1c6b1c1c75  src/SectorSummary.tsx
de9f3dacbce4863bdb1d5347b81d73cfd3e1b1733a8c2f8f3cc4fef800b4a2b8  src/types.ts
```

## Changes and operational limits

Only `docs/sector-grounding-review.md` was created in the repository. Temporary reviewer harness files and ordinary Cargo artifacts were produced outside application sources. No application/test/config edits, staging, commits, credential access, model calls or external report publication occurred. The specifically configured `.Codex/rules/common/research-capture.md` was absent; the discovered alternate rule exempts internal verification and delegates any applicable external capture to the commander. Read-only review scope was preserved.
