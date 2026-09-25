# NASA Technology image review — strict focus gate remains blocked

Verified 2026-09-25 UTC. **No new asset was approved.** The bounded current-feed search found **10 unique articles, 0 focused articles** through the unchanged production classifier. All ten are `sections:["others"]`, including the strongest rights candidate below. The three-focused-publisher acceptance gate therefore remains blocked; a passing audit test is not a passing coverage gate.

No source catalog, classifier, permission rule, parser, existing asset, frontend, native smoke or installer file was changed. NASA's existing Guam image/video approvals remain intact. No forced section scope, headline/excerpt rewrite, full-article substitution, invented enclosure, paid API or AI-generated image was used.

## Bounded search and production classification

Scope was the current NASA Technology RSS, not older paginated posts or unrelated NASA galleries. The captured feed contained ten items; its SHA-256 was `a730093099d25789889f12e459976d9ecb54fdd1662ad7932de9eecfdc285aea`.[1] An independent production `Backend::execute(refresh)` into a new temporary SQLite database returned the same ten article URLs. The checked evidence JSON programmatically verifies the item count, URL uniqueness and focused count.

| Current item | Production section |
|---|---|
| Explosive Intensification for Hurricane Polo | Others |
| NASA’s Machines for Mars Make Beer Bubbly | Others |
| Cloudy Cloak Over the Northwest | Others |
| NASA Celebrates Restoration of Guam Station Damaged by Typhoon Mawar | Others |
| NASA’s Life-Saving Technology Where Cell Signals Can’t Go | Others |
| Anak Krakatau Rumbles Again | Others |
| NASA Calls for Proposals to Accelerate Lunar Surface Technologies | Others |
| NASA Technique for Manipulating Satellite Photos Now Reveals Ancient Images | Others |
| NASA Selects Blue Origin as Mars Telecommunications Network Provider | Others |
| Ribbon-Cutting Event for NASA Deep Space Network’s Deep Space Station 23 | Others |

Every result has the existing reason `No focused-section evidence; kept under Others`. `src-tauri/src/topics.rs` classifies title plus supplied excerpt, not full `content:encoded`, source topics, page categories, or the ordinary-language fact that a story describes technology. The NASA catalog entry has no `sectionScope`. No classifier change was permitted or made.

The supplied lunar-story excerpt says NASA seeks proposals for technology and infrastructure, power generation, oxygen extraction and construction.[1] It contains none of the unchanged classifier's qualifying technology terms. This is an actual production result, not an inferred classification or a request to broaden the classifier.

## Strongest rights candidate — not approved, not focused

- Article: **NASA Calls for Proposals to Accelerate Lunar Surface Technologies**.[3]
- Exact RSS GUID: `https://www.nasa.gov/?post_type=press-release&p=1045129`.[1]
- Exact article URL: `https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/`.[1][3]
- Publication value: `Tue, 08 Sep 2026 20:16:16 +0000`.[1]
- Exact original asset: `https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png`.[3][4]
- Actual HTTP response: **200**, no destination change, `Content-Type: image/png`.
- Original downloaded file: **4,620,791 bytes**, **1280 × 720**, PNG signature/IHDR verified and image visually inspected.
- Original SHA-256: `d2775cd0953b366fcf847d1910c3108614d0310ab18e17a26a1d1914d2ea83de`.
- Production classification: **Others**, no media attached or authorized.

The RSS `content:encoded` figure links the query-free original PNG directly, while its `img src` is the `?w=1280` display variant. The article's matching figure and Open Graph original image both identify the query-free asset. The figure caption is “Artistic concept of lunar surface technologies and infrastructure capabilities, including in-situ resource utilization oxygen production systems, surface power systems, in-space manufacturing tools, and advanced nanomaterials production.” The adjacent credit is **“Credit: NASA”** in both article and RSS.[1][3] No hero/related-story substitution or URL-derived guess was used.

Visual inspection showed a lunar construction/resource-processing **artistic concept, not a photograph**. A NASA insignia is visible on the robotic arm; no identifiable person or third-party credit/copyright marking was visible. Do not claim the image contains no logo. A future narrowly approved editorial display would need to preserve its artistic-concept description and NASA attribution, not extract the insignia for app branding or use the image promotionally.

### Rights basis and exceptions

NASA's current media policy explicitly says its content generally is not subject to US copyright and “You may use this material for educational or informational purposes,” including Internet pages. It also says factual non-endorsing use does not need explicit permission and **“NASA should be acknowledged as the source of the material.”**[2] This is an informational/editorial reuse basis for the specifically NASA-credited asset, not a source/domain-wide license and not separate written approval of this application.

The policy expressly excludes third-party material: **“NASA’s use does not convey any rights to others to use the same material.”**[2] It also restricts endorsement, commercial/promotional use involving logos/employees, identifiable-person publicity/privacy rights, merchandising and AI attribution/insignia use.[2] The inspected robotic-arm insignia makes the editorial-versus-promotional boundary material. No AI permission or app branding right is inferred.

Two other technology-related feed items were rejected during the bounded review: the brewery carbon-capture image is credited **Chart Industries Inc.**, while the search-and-rescue story has **Easton Barrett** and **ACR** image credits.[1] NASA hosting is not permission to reuse those images. Related-topic thumbnails are not treated as story-owned imagery.

The lunar PNG is therefore a plausible specifically credited informational-use image, **but not an eligible focused item under the unchanged application behavior**. There is no reason to add it merely to increase media volume: it would not resolve this task. The existing NASA rights schema is also JPEG/MP4-only; PNG support would require a separate tested format change. Neither that change nor the allowlist addition was made.

## Verification and files

Created:

- `src-tauri/tests/nasa_focus_live.rs`: opt-in bounded live audit; real feed, temporary DB, compiled policy, private provenance, production classification and production image loader. No persistent user DB.
- `docs/evidence/focus-nasa-technology-audit.json`: actual per-item results, verified counts, candidate original identity, approved-image preview evidence and complete command output.
- This report.

| Command | Observed result |
|---|---|
| `cargo test --test nasa_focus_live -- --ignored --nocapture` (from `src-tauri`) | **1 passed**, two actual live runs; final run warning-free. **10 items, 0 focused, 1 existing approved image loaded**. |
| `cargo test --lib` | **137 passed, 0 failed, 8 explicitly ignored**. Includes exact NASA GUID/supplied-asset checks, wrong-item denial, private media authorization/import revocation and original byte/count/hash validation. |
| `python tests/test_source_catalog.py` | **9 passed**. |
| `python scripts/check-v02-sources.py` | Exit 0, **69 total / 58 enabled**, `errors: []`. |
| `rustfmt --check --edition 2021 tests/nasa_focus_live.rs` | Exit 0. |

No RED→GREEN approval change was attempted because no eligible candidate was found. The new test is an observation/verification harness only; it does not assert that the feed must forever have zero focused items. It prints future changed classifications honestly and fails if refresh or authorized image loading fails. The write tool's automatic lint incorrectly assumes Rust 2015; actual edition-2021 formatting and Cargo compilation passed.

### Existing approved media still works

Production `media_load` used explicit `profileId:default`, the current snapshot replacement token and `automatic:false`, after normal database authorization. The existing Guam JPEG passed the unchanged loader's original transport pins:

- Original bytes: **3,468,255**.
- Original SHA-256: `9edc61505384e8eff56548e2989b89586c3a568bdd2da136e33a6335ccd81dfa`.
- Returned proportional PNG preview: **494,878 bytes**, **640 × 407**.
- Preview SHA-256: `5b24cadd66449884174646fe7511b53bd5faffd195d47005caf16b575873b8c5`.

Original transport integrity and transformed preview integrity are distinct. This check decoded the returned preview; it did not exercise native WebView rendering or play the existing video. The video approval was authorized but deliberately not downloaded by this image audit.

## Parent acceptance decision

**Keep strict focused-publisher coverage blocked.** The parent may prefer focused approved samples when available, but the current NASA feed supplies none under the unchanged classifier. Do not substitute Guam, the lunar concept, or a forced source tag to pass the gate. Revisit only when genuinely qualifying feed material arrives or a separately authorized product decision changes the classifier; no such change is part of this task.

Research-panel capture is delegated to the parent/commander under the available research-capture rule. The requested `.Codex/rules/common/research-capture.md` path was absent; the discovered desktop harness copy explicitly assigns subagent reports to the commander.

## Sources

[1] https://www.nasa.gov/technology/feed
[2] https://www.nasa.gov/nasa-brand-center/images-and-media
[3] https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies
[4] https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png
