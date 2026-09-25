# Federal Reserve financial-market diagram integration

Verified: 2026-09-25 UTC. Scope: catalog, bounded feed parser, existing rights/media gates, regression tests and explicit live native **Backend** path. **This is not visual WebView acceptance or a claim that the overall three-publisher gate has passed.**

## Outcome and policy boundary

Added `fed-feds-notes`, the Board of Governors' free/keyless official FEDS Notes RSS. The source name says **staff analysis**; IPC kind is `official notice`, the existing agency-origin category, not independent reporting or Board concurrence. AI remains false, refresh floor is 240 minutes, and no dependency, article scraper, paid access, generic image-host allowlist or full-text extraction was added.

Only the reviewed note's supplied introductory excerpt and Figure 1 are enabled. Other notes remain discoverable as metadata with empty excerpts and no images. The catalog's `storage:excerpt` is a ceiling, further narrowed by the parser's exact-item gate. Board source/author credit and the original article link are retained. The caption explicitly says **Financial-market diagram**, **authors' views**, **not Board concurrence**, **not an official recommendation or endorsement**, and **no cropping**.

The rights basis is the Board's explicit public-domain/copy/distribute grant, with its non-Board-material exception, applied only to the inspected original Figure 1. This supports credited local display/cache/backup copies of the approved material, not a claim that the policy names technical cache operations. No new offline image-export feature is implemented. Figure 2/vendor-associated data, seals/logos, regional Reserve Bank assets and arbitrary/unrelated host images remain unapproved. See the detailed evidence and exclusions in [focus-stock-image-rights-followup.md](focus-stock-image-rights-followup.md), and [Board policy](https://www.federalreserve.gov/disclaimer.htm).

## Exact identity

- Feed: `https://www.federalreserve.gov/feeds/feds_notes.xml`
- Article **and** GUID: `https://www.federalreserve.gov/econres/notes/feds-notes/repo-markets-and-the-feds-balance-sheet-implications-for-monetary-policy-implementation-20260826.html`
- Published: `Wed, 26 Aug 2026 18:30:00 GMT`
- Figure 1: `https://www.federalreserve.gov/econres/notes/feds-notes/fig1-4069.png`
- Original MIME: `image/png`; original bytes: **98,752**.
- Original SHA-256: `56373565c12becc07967821a416196ef2f61b2237dd7444a9840cd04128369aa`.
- Original dimensions from the rights review: **1221 × 471**.

The existing schema could express exact GUID/link/asset/count/hash/credit, but its media-rule enum did not support a Fed policy and image approvals were JPEG-only. `fed-exact-diagram-v1` adds PNG support only for this rule and **requires SHA-256** like the existing NASA rule. MIT/ESA retain their existing expressly limited no-hash modes; NASA approvals are unchanged.

The real RSS item has **no media enclosure**. The parser attaches the compiled reviewed Figure 1 only after authoritative source-policy validation and matching both exact GUID and alternate article link. No request to article HTML is used for runtime discovery. The resulting private parser receipt and normal database media authorization are required before the unchanged bounded production loader checks original MIME/count/hash and decodes the preview.

## Genuine Stocks evidence

`src-tauri/tests/fixtures/fed-repo-note.xml` preserves the real captured item fields; only its surrounding channel wrapper is a harness. The item was fetched directly from the official RSS, not given an invented enclosure or financial headline. Captured full-feed SHA-256 was `e36163905ee31eb4f0edda7b093729287f39530b6f742e6024d244cd5f88980b`.

The supplied introduction begins “As the Federal Reserve (Fed) navigates periods of balance sheet expansion and reduction...” and describes overnight Treasury repo/short-term funding markets. The unchanged classifier's existing `federal reserve` term yields:

```json
{"sections":["stocks"],"classificationReasons":["Headline/excerpt contains stock or market terminology"]}
```

No `sectionScope` override or classifier change was added. This is financial/funding-market analysis, **not individual-equity reporting**. Both the captured-item test and production live database snapshot verified the classification.

## RED → GREEN and regression evidence

Commands below ran from the repo root unless `src-tauri/` is specified.

| Command | Observed result |
|---|---|
| `cd src-tauri && cargo test --lib fed_diagram_real_rss -- --nocapture` (RED) | Failed first because the reviewed FEDS Notes source was not bundled; after catalog addition failed with `Unsupported media rights rule`. |
| Same command after minimal rights/parser extension (GREEN) | 1 passed. Correct media, credit, disclaimer, no AI and evidence-based Stocks classification. |
| `cd src-tauri && cargo test --lib fed_diagram_unrelated -- --nocapture` (RED) | Failed because an unreviewed item retained its introduction. |
| `cd src-tauri && cargo test --lib fed_diagram -- --nocapture` after narrowing storage (GREEN) | Initially 2 passed; final focused suite **5 passed**. |
| `python tests/test_source_catalog.py` (RED) | 2 failures: new media source not in the reviewed checker contracts. |
| `python tests/test_source_catalog.py` after exact checker contract (GREEN, final rerun) | **9 passed**, exit 0. |
| `python scripts/check-v02-sources.py` | Exit 0; **69 total, 58 enabled**, unchanged 3 conditional AI sources, 4 conditional media sources, `errors: []`. |
| `cd src-tauri && cargo test --lib` | **137 passed, 0 failed, 8 explicitly ignored**. Includes existing NASA/MIT/ESA, host rights/import/revocation, media and parser regressions. Not a claim about the full integration suite. |
| `rustfmt --check --edition 2021 --config skip_children=true src/rights.rs src/services.rs tests/rights/fed_diagram.rs tests/media/fed_diagram.rs tests/fed_diagram_live.rs` from `src-tauri/` | Exit 0 after formatting only assigned files. |

Focused regressions cover exact item GUID and link mismatch; query variants; neighboring Figure 2 and seal candidates; unrelated-item metadata-only behavior; disabled/changed source and policy; malformed/missing SHA-256; caption/credit/provenance; original MIME/count/hash mismatches; forged compiled approval; and denial of Figure 2 before polling a network future. Deliberately invalid test transport bytes are marked as such, never treated as publisher evidence.

## Explicit live production Backend verification

```sh
cd src-tauri
cargo test --test fed_diagram_live -- --ignored --nocapture
```

**Passed**, including a final rerun. The test creates a new temporary SQLite database, enables only this feed, calls production `Backend::execute(refresh)`, reads the actual snapshot, checks its private media authorization, and calls production `Backend::execute(media_load)`. No custom source, fake receipt, fixture HTTP transport, authorization bypass or user database is involved. The test reads the current replacement token and uses an explicit manual request with `profileId:default` and `automatic:false`.

Observed live output:

```text
source="fed-feds-notes"
sections=["stocks"]
feed_items=15
original_pin_bytes=98752
original_pin_sha256=56373565c12becc07967821a416196ef2f61b2237dd7444a9840cd04128369aa
preview_bytes=38710
preview_sha256=f865c836456201cd75891a999ba6b02e44502ef36797ecf6b0f20a6a04a1c032
preview_dimensions=640x247
1 passed; 0 failed
```

**Original transport pins and transformed preview evidence are different.** The unchanged native loader enforces the original pin before decoding. The returned PNG is a bounded proportional preview, not the original file; its hash must not be presented as the publisher file's hash. The live test verifies aspect ratio and that unrelated live items have no media/excerpts. AI authorization is denied.

The first live test attempt correctly rejected an older request shape lacking profile/replacement identity (`Database replaced: reload before making a new change`). The test harness was updated to the current host contract; no production gate was weakened. Automatic write-tool Rust lint used an incorrect Rust 2015 default; explicit edition-2021 rustfmt and real Cargo compilation/test results above are the relevant checks.

## Remaining parent frontend/native acceptance

- At inspection, `src/daily-use.css` had `.story-row .thumbnail-frame img { object-fit: cover; }`, and `src/styles.css` also had a thumbnail `cover` rule. This will crop a wide diagram in a fixed-aspect card. **Parent must use a non-cropping fit for this diagram and visually verify the whole figure.** No frontend files were edited by this subtask.
- Reader styles already used `object-fit: contain`; the backend preserved aspect ratio. Neither fact alone proves the final native card/reader view is correct or legible.
- Parent must rebuild the embedded catalog/backend/frontend as appropriate and visually verify the current native Windows app, with visible attribution/disclaimer and the entire diagram. This subtask did not exercise App.tsx, MediaSession, the packaged application or installer.
- The exact reviewed note can rotate out of the RSS. That is an honest empty-media state; do not invent a replacement asset or widen the allowlist.
- No overall three-unrelated-publisher visual gate, literal-photo claim, investment recommendation, or complete markets-coverage claim is made here.
