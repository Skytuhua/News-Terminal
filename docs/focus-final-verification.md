# Focused News Terminal: current verification

Verified 2026-09-25. Supersedes the earlier implementation handoff; this is not a claim of comprehensive news/photo coverage.

## Implemented and exercised

- AI / Technology / Stocks / expandable Others; existing profile, backup, tab, saved/read/hidden and detached-window tests retained.
- 69 reviewed free/accountless feeds, 58 enabled. The original 80–120 breadth target was not achieved; unreviewed feeds were not added to inflate the count.
- Separate News / Models / Benchmarks views. OpenRouter catalog validation and change tracking, selected Qwen repositories, independent persistent metadata caches, attributed Arena and SWE-bench panels. No model inference runs from these views.
- Consent-aware automatic thumbnails, manual reader loads, retry recovery, cancellation and replacement/profile isolation. Proportional uncropped previews, visible credits, no persistent image-byte cache.
- Exact Federal Reserve Board Figure 1 approval; unrelated notes remain metadata-only and Figure 2/vendor-associated assets are denied. See [rights evidence](focus-stock-image-rights-followup.md) and [integration verification](focus-fed-diagram-verification.md).
- Free-only enforcement blocks cloud inference even if old settings are imported. Reddit/X/Bluesky remain external-link-only, not scraping integrations.

## Verified results

| Check | Observed result |
| --- | --- |
| TypeScript | Passed |
| JavaScript unit tests | 18 passed |
| Full browser fixture suite | 175 passed, zero failed, after import/media retry/status fixes |
| Final uncropped-image regression suite | 11 passed after the final CSS change |
| Final Rust suite | 266 passed, zero failed, 19 intentionally ignored |
| Clippy, all targets, warnings as errors | Passed |
| Rust formatting | Passed |
| Source catalog Python tests | 10 passed |
| Source policy checker | 69 total / 58 enabled; zero errors |
| npm audit | Zero vulnerabilities reported |
| Windows-applicable license inventory | Passed; 555 packages, zero applicable evidence gaps |
| NSIS installer build | Passed; unsigned local build |
| Native focused smoke, rebuilt executable | Four checks passed, zero failed |

Ignored Rust tests include explicit network/local-service checks; not all ignored tests were run. Separate live metadata and Fed-media tests were run. Thirty other-target/optional missing-license-text entries remain outside the Windows-applicable inventory gate.

The browser suite uses fixtures and is not native evidence. Native smoke uses actual Rust IPC, real network responses, and a fresh temporary data directory, without changing normal app data. Internal evidence files include `focus-final-rust-tests.log`, `focus-final-clippy.log`, `focus-blocker-browser-suite.log`, and `focus-native-smoke-final-fed.json` under `docs/evidence/`.

## Native image evidence and qualifications

The final smoke rendered three independent publishers:

| Publisher | Observed classification | Image |
| --- | --- | --- |
| NASA | Technology | Lunar surface technologies artistic concept (not a photograph) |
| MIT News | AI and Technology | Reviewed research image |
| Federal Reserve Board | Stocks | Public-domain repo-market diagram |

The final images-only native run (`focus-native-smoke-focused-coverage.json`) demonstrates three independent publishers with focused-section images, collectively covering AI, Technology and Stocks. It exercises rows and open readers. Classifier version 2 fixes precise space-engineering terminology required by the specification, with negative cases and migration/state preservation tests. The unrelated Guam sample remains Others; no source-wide override was added. The financial-market diagram is not an equities photograph, daily stock-photo coverage, or investment advice. Most stories still have no reviewed image. No Guardian/BMW permission is claimed.

Independent review found no blocking correctness/security defect in the reviewed code, but identified two acceptance gaps. The harness now counts only publishers with focused-section samples; the old `releaseReady:true` did not prove that stricter requirement. A subsequent images-only native run (`focus-native-smoke-reader-captions.json`) passed row and open-reader decoding/caption checks, and visual inspection confirmed the Fed diagram and author-views/no-endorsement disclaimer. The strict third-focused-publisher requirement was subsequently met by the separately reviewed lunar-technologies item; see [classification and rights verification](focus-space-engineering-fix.md). Arena returned no rows during one intervening live attempt; a later complete run passed. Upstream availability remains variable and last-good caches are used when available.

## Remaining publication checks

- Independent review found no blocking correctness/security defect. Its reader/coverage evidence gaps were addressed by later native runs.
- Latest fresh-cache full native runs failed because Arena returned no live rows. Earlier all-endpoint native runs passed; the latest image/reader coverage run passed. Do not call the latest all-endpoint run green. Upstream availability is outside the application’s control.
- Installer payload validation passed after diagnosing a 7-Zip solid-Deflate detection collision. The verifier validates the original CRC and proves full decoded-stream equality before inspecting a recompressed temporary copy; the distributed installer is not changed. Exact notice/plugin checks passed. A separate smoke of the extracted packaged executable passed all four checks (`focus-native-smoke-packaged.json`). This is not an installation/uninstallation UX test.
- GitHub publication is tracked by the repository commit history. GitHub Pages API returned 404; no Pages site deployment is claimed.
- Final pre-publication browser rerun passed all 175 tests. The latest extracted packaged executable also passed all three images-only native checks, including strict focused-publisher coverage (`focus-native-smoke-packaged-focused-coverage.json`).
