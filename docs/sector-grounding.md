# Sector grounding: host candidates, AI-selected quotation IDs

## Outcome and API contract

The host extracts bounded **verbatim, source-specific quotation candidates** and the model selects their opaque IDs. The model no longer writes or retypes any displayed quotation, citation or evidence. Existing result fields, including `bullets[].text`, `bullets[].citations` and `bullets[].evidence`, are unchanged:

```json
{
  "text": "By 48 hours, increasing northeasterly vertical wind shear should work to induce gradual weakening.",
  "citations": ["S2"],
  "evidence": [
    {
      "sourceId": "S2",
      "quote": "By 48 hours, increasing northeasterly vertical wind shear should work to induce gradual weakening."
    }
  ]
}
```

`evidence` remains required by the existing backend validator. A renderer may model it as optional when accepting older API fixtures/responses, but must not describe absent evidence as validated. This candidate-ID change modifies only sector/services Rust, their relevant unit tests, and this document/evidence logs; no frontend, version, permission or `lib.rs` change is needed. The existing final-delivery validator still checks host-constructed bullet JSON against actual bounded inputs under current-input/permission locks.

Mechanical requirements:

- One citation and one evidence object per bullet; `evidence[0].sourceId` equals the citation and belongs to the host-selected input map. No model URLs or extra evidence fields.
- `text` equals `quote` exactly and is one contiguous substring of that source's **supplied** title or excerpt, bounded at whitespace or the field's start/end. This conservative boundary rule rejects clipped words, signs, decimals and percentages, but can reject otherwise harmless punctuation-adjacent fragments too.
- Both prompt construction and validation use the same sanitized, bounded input builder: title 500 characters, excerpt 2,000 characters. Content beyond those bounds, source-name metadata, source URLs, other articles and outside knowledge are not evidence.
- Retain existing 1–6 bullet, 700-character bullet and 8,192-byte response limits, plain-text restrictions and strict JSON shape. Any invalid bullet rejects the entire response; no partial prose or silent deterministic replacement is returned.
- Validate in the existing provider response path and again at final host delivery, under the existing current-input/permission checks. Consent, fallback, fixed destinations, cancellation, source-policy checks and private authorization receipts remain unchanged. No new provider, dependency, source fetching or persistence.

## Candidate selection protocol

The internal provider response is now only `{"selectedCandidateIds":["<an offered opaque ID>"]}`. This is not a renderer/API change. `services::sector_response` validates exact ID membership, constructs the existing bullet/evidence fields from host candidates, checks decoded credentials and the unchanged quotation validator, then passes the constructed JSON to the existing final host validation. Free-form bullet JSON is rejected at the provider boundary, even if it contains a real quotation. There is no legacy model-output acceptance path, partial recovery, extra model retry, or deterministic output masquerading as AI.

Candidate extraction uses the same bounded sanitized sources supplied in the prompt:

- At most 12 sources and 8 candidates per source. Candidates are at most 700 characters; title/excerpt duplicates within a source are removed. Empty candidate lists fail closed.
- A complete title or short complete excerpt stays whole. Longer excerpts are grouped into adjacent sentence-like passages up to 700 characters, retaining contiguous whitespace and nearby context. An overlong sentence is omitted, never split. Headline-only inputs offer the title only.
- Titles at the 500-character cap are omitted. Excerpts at the 2,000-character cap cannot use their final unfinished passage, even if their last character is a decimal point. These conservative cap checks also cover text already truncated by feed ingestion, where the original next character is no longer available. A genuinely complete field ending exactly at a cap may be omitted too.
- Longer excerpts with incomplete trailing prose omit that fragment. Punctuation followed by whitespace is a heuristic, not a language-aware sentence parser. Short fields may themselves be incomplete upstream; no full-article completeness is asserted.
- Opaque IDs bind the exact source input and quotation using the existing SHA-256 dependency; ambiguous IDs and duplicate source IDs fail closed. The model cannot assign a different source to an ID. Hashes are not authorization: exact membership in the reconstructed current candidate list is.
- Typed parsing rejects extra fields, duplicate JSON keys, wrong types, absent/unknown/stale IDs, duplicate selections, and selections outside 1–6. Any bad selection rejects the entire response. Both the provider response and expanded bullet JSON retain the 8,192-byte limit; Unicode expansion cannot bypass it.

The prompt asks for 2–4 useful choices from distinct stories and asks the model to preserve subject and qualifications. Only the selection is AI-generated. No transport/API format addition was required: Ollama retains its existing `format: "json"`; fixed endpoints, existing consent-aware provider fallback and cancellation remain untouched. Preview sources, selected/excluded counts, coverage, permission checks, private receipts and persistence behavior are unchanged.

## Why number membership is insufficient

The real native capture `docs/evidence/sector-native-debug-r5.json` contained valid citation IDs but incorrect claims:

- S1's **60 percent** development chance belongs to **AL90**, not Fay. S1 mentions both systems; merely checking that “Fay” and “60” occur in S1 cannot establish attribution.
- S2 says weak shear for another **36 hours**, with increasing shear **by 48 hours**. Both numbers already occur in the input; accepting any input number would admit the observed rewritten relationship.

Therefore the validator does not pretend a numeric-token whitelist or exact supporting quotation can establish arbitrary paraphrase entailment. It requires the displayed bullet itself to be the quotation. Rewriting `48` to `36`, assigning the AL90 probability to Fay, inventing a quotation, or moving that probability to S2 fails closed.

## What this does NOT establish

Exact quotation matching is **mechanical grounding, not factual entailment, truth, completeness, currency or an emergency advisory**. Source material can be incorrect. A model can select a misleading fragment, omit context, choose a stale passage, or overemphasize a source. A passage may span different subjects already present in an input. Whitespace boundaries prevent token clipping, not all selective quotation or negation/context omission. Truncated input can itself end mid-sentence. These are not solved by this change.

The returned warning explicitly says: “AI-selected quotations, unverified. Exact text and source IDs were checked mechanically, not factual entailment, context or truth. Excerpts may be incomplete. Check the original sources.” Host-owned links, issue times, input scope and attribution remain available. Ordinary deterministic reading/outlines remain available when generation is rejected.

## Candidate-ID verification (current)

Observed RED→GREEN cycles covered missing candidate lists, provider acceptance/construction from IDs, duplicate selection rejection, host-clipped numeric tails, headline-only scope, and already-persisted parser-cap decimal clipping. The parser-cap test initially had an overly broad text assertion (`x` also occurs in “context”); that assertion was corrected and the old production behavior was explicitly replayed RED before restoring the fix GREEN. Legacy source-specific/number/whitespace/evidence validation tests were retained unchanged. Additional cases cover unknown and stale IDs, attempted source reassignment, duplicate JSON keys, wrong shapes/types, empty/oversized selection lists, links/markup, no safe candidates and oversized expanded Unicode output.

Final commands after the parser-cap fix:

- `cargo test --manifest-path src-tauri/Cargo.toml`: **196 passed, 0 failed, 15 ignored**, machine-counted across 18 test/doc-test binaries. `src-tauri/tests/sector/candidate-final-full-rust.log`.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: **exit 0**. `src-tauri/tests/sector/candidate-final-clippy.log`.
- Rust 2021 `rustfmt --check` on the owned Rust files: **exit 0**.

### Three actual retained-input Qwen requests

After the final code change, the retained-database reproduction command below was executed three separate times through the actual `Backend::execute` preview/generation APIs and local `qwen3:4b-instruct-2507-q4_K_M` transport. Each run backed up the retained test database read-only, checked the original input identity/content and exported state, and did not refresh or modify permissions or start/stop Ollama.

| Run | Generated UTC | Actual result | Quotations | Evidence log |
|---|---|---|---:|---|
| 1 | 2026-09-24 06:26:07 | Accepted | 4 | `src-tauri/tests/sector/qwen-candidate-final-r1.log` |
| 2 | 2026-09-24 06:26:09 | Accepted | 4 | `src-tauri/tests/sector/qwen-candidate-final-r2.log` |
| 3 | 2026-09-24 06:26:11 | Accepted | 4 | `src-tauri/tests/sector/qwen-candidate-final-r3.log` |

All three outputs used S1 and S2 with identical quotation text, character lengths **680, 682, 635 and 556**, and unchanged preview source maps/coverage. Exact quotation/evidence/source identity was checked, not inferred from a passing smoke-test exit code. The returned weather passage preserves both **another 36 hours** of weak shear and increased shear **by 48 hours**, without inventing a relationship. **3 accepted / 0 rejected**, no substitute/fallback text. This limited repeated-input sample does not establish a general model success rate, factual accuracy, contextual completeness, or semantic entailment. The passages are intentionally longer than polished paraphrases and retain source headers/context.

The initial candidate implementation also produced three accepted real requests (`qwen-candidate-r1.log` through `r3.log`). The final runs above supersede those earlier checks after conservative parser-cap handling was added. Earlier quotation-copy success below does not contradict the later native transcription rejection that motivated ID selection (`docs/evidence/sector-native-grounded-final.json`). Native UI and release acceptance remain with the parent integration task.

## Earlier quotation-validator verification (historical)

Observed TDD, before the relevant production changes:

1. Actual captured output without evidence: **RED**, 0 passed / 1 failed, exit 101. After evidence became mandatory: **GREEN**.
2. Altered `48` → `36` with a real supporting quote, and wrong-source `60 percent`: **RED**, 1 passed / 2 failed, exit 101. After exact quote/source/text checks: **GREEN** (3 passed).
3. Clipped numeric/word fragments: **RED**, accepted `0 percent.` from `60 percent.`, exit 101. After boundary validation: **GREEN** (4 grounding tests passed).
4. Updated provider prompt/final-host tests: **RED**, 11 passed / 3 failed; after shared prompt inputs were used at both validation boundaries: **GREEN**, 14 passed.

Additional regressions cover evidence IDs/shapes, partial-output rejection, exact sanitized/bounded inputs, unescaped credential rejection, and existing sector cancellation/revocation/current-input races.

Final commands and retained output:

- `cargo test --manifest-path src-tauri/Cargo.toml`: **191 passed, 0 failed, 15 ignored** across 18 test/doc-test binaries. `src-tauri/tests/sector/grounding-full-rust.log`.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: exit 0. `src-tauri/tests/sector/grounding-checks.log`.
- Explicit Rust 2021 rustfmt check of owned changed files: exit 0.

No unrelated worker files were modified, committed, staged or packaged. Independent review and frontend/native acceptance of the new evidence presentation remain with the parent integration task.

## Earlier quotation-copy Qwen replay (historical)

The successful run used the already-running `127.0.0.1:11434`, model `qwen3:4b-instruct-2507-q4_K_M`, through the actual `Backend::execute` preview/generation APIs and unchanged consent-aware transport. It generated at **2026-09-24 05:48:31 UTC** and returned **four accepted quotations**, covering S1's Cabo Verde low-pressure system and S2's Fay convection, intensity and track. Their character lengths were 387, 278, 401 and 227. This was useful extractive output, not a fail-closed rejection, and not semantic certification. It did not make the earlier 60%-to-Fay or 48-to-36 rewrites.

The test opens a read-only SQLite connection to the original native smoke's temporary database and uses SQLite backup into a new test-owned temporary database, preserving private authorization receipts and the retained selected articles. It compares original IDs, titles, URLs, publication times and excerpts before generation, selects the retained September 23 date without altering it, rejects enabled/consented remote providers, and confirms generation leaves exported state unchanged. It does not refresh a feed, access the production database, import fabricated grants, or start/stop Ollama. Post-run model health was checked.

Reproduce while the retained temporary native database remains available:

```sh
NEWS_TERMINAL_RETAINED_SECTOR_DB='C:/Users/user/AppData/Local/Temp/news-terminal-sector-native-8j9wJJ/news-terminal.sqlite3' \
cargo test --manifest-path src-tauri/Cargo.toml --test sector_summary actual_local_qwen_retained_government_inputs -- --ignored --exact --nocapture
```

The ignored test deliberately distinguishes accepted output from `Invalid sector synthesis` fail-closed output in its printed `result`. A passing replay test alone is not a claim that Qwen produced useful output; inspect `result.Ok` versus `result.Err`. Other transport/setup errors fail the test. Missing retained database is a blocker, never a reason to recreate receipts or relax policy.

Evidence is preserved without editing captures:

- `src-tauri/tests/sector/fixtures/native-r5.json`: exact projection of retained preview, original inputs, actual host result and UI bullets, with original capture path/SHA-256. The original capture remains unchanged: `195d7832475ef5dee36e528bc5ad69a2b035e7b25299fcdd57cb4fd90fe65156`.
- `src-tauri/tests/sector/qwen-grounding-r1.log`: initial harness failure (`Unknown source`) before generation because `Database::memory()` does not seed catalog sources. No fabricated replacement output.
- `src-tauri/tests/sector/qwen-grounding-r2.log`: successful actual host result and post-run Ollama health. Rather than manufacture parser receipts by re-ingesting captured article JSON, the corrected harness reuses a read-only backup of the retained native database.
