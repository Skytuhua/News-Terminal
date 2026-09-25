# Space/engineering Technology fix and exact NASA concept approval

Verified 2026-09-25 UTC. **Classification bug fixed independently of media permission.** The real NASA Technology refresh now returns the lunar surface technologies article as **Technology**, while Guam and the other nine current items remain **Others**. The exact NASA-credited lunar artistic concept passed the production authorized image loader. This is host/feed evidence, **not a native three-publisher acceptance pass**; the parent must rebuild and verify native rendering.

## Explicit spec mismatch and scope

Approved `specs/002-focused-news/spec.md:10` includes **space/engineering technology**. The previous `topics.rs` technology vocabulary covered chips/software/cybersecurity but had no qualifying space-engineering phrases. Consequently, the unaltered headline **NASA Calls for Proposals to Accelerate Lunar Surface Technologies** was Others, contrary to the approved contract. The earlier `focus-nasa-technology-media.md` accurately recorded the old runtime behavior; its all-Others result is historical, not the intended spec.

Added bounded, normalized whole-phrase evidence: lunar surface technology/technologies, spacecraft engineering/propulsion, space propulsion, satellite communications, in-space manufacturing, in-situ resource utilization, thermal protection system/systems, rocket engine/engines and additive manufacturing. No bare `NASA`, `space`, `launch`, `station`, `engineering` or `technology` trigger was added. No source scope, title/excerpt rewrite, URL trigger, full-article classification input or media-based classification was introduced.

Tests exercise every phrase independently in title and excerpt for both a generic publisher and the unchanged unscoped NASA source. Astronomy observations, launch-only reports, geography/volcano/cloud stories, police stations, generic municipal engineering, near-word matches and the unchanged Guam headline remain Others. Actual live Guam title **and supplied excerpt** also remain Others.

### Cached state

`CLASSIFICATION_VERSION` is now **2**. Existing `Database::open` and import already transactionally run `reclassify_all`; no replacement migration framework or schema version was needed. Tests seed a previously classified version-1 Others row, reopen twice, and import stale classification. They prove the new section/version and preserve article ID, URL, text, source identity, timestamps, history, group ID and saved/read/hidden state. The existing missing-classification legacy case is also retained. No media or AI rights are created by topic backfill.

The retained-state assertions read canonical `Database::article`, not the dynamically ranked snapshot: the latter intentionally recomputes ranking score/reasons. An initial overbroad snapshot comparison exposed that harness distinction and was corrected without changing production ranking behavior.

Catalog reconciliation remains the existing design: a changed rights-policy revision invalidates private provenance. Merely reopening/backfilling a cached article does **not** attach or authorize a newly approved image; an ordinary successful feed refresh must supply the exact binding again. Imported article JSON never grants private media authority.

## Observed RED → GREEN

| Slice | Observed RED | GREEN |
|---|---|---|
| Specific engineering terminology | `space_engineering_requires_specific_technology_phrases`: `lunar surface technology`, `[Others] != [Technology]`, exit 101 | Minimal phrase additions; all 5 topic tests pass |
| Cached classifier revision | `version_one_cached_space_engineering_is_backfilled_without_state_loss`: version `1 != 2`, exit 101 | Version bump; all 7 migration tests pass |
| NASA bounded PNG schema | `rights_nasa_png_schema_keeps_hash_and_size_requirements`: `Invalid approved media format`, exit 101 | Permit PNG for existing SHA-required NASA rule only, retaining image byte limit and hash requirements |
| Exact real-feed media binding | `rights_nasa_lunar_real_item_is_exactly_bound_and_not_ai_permission`: media count `0 != 1`, exit 101, both before and after catalog-only addition | Exact approval plus supplied-anchor binding; wrong GUID/item/asset/query and missing-anchor variants denied |
| Catalog guard | Python lunar pin test rejected the new approval under the old two-asset rule, exit 1 | Exact lunar tuple and caption/restrictions checked; full catalog suite passes |

**Independent ordering:** after the classification/version tests passed, the original live audit was run before approving any lunar image. It returned **10 items / 1 focused / 1 previously approved Guam image loaded**; the lunar article was Technology with `media:null`. Only then was its rights chain re-reviewed and the exact approval implemented.

## Permissions chain — narrow informational/editorial use

1. NASA's media policy explicitly permits educational/informational use and factual non-endorsing use without separate explicit permission; it requires acknowledging NASA. It also warns that NASA insignia/identifiers are legally protected and that imagery is available subject to the usage guidelines. This approval relies on the stated **use permission**, not a blanket claim that everything NASA hosts is public domain.[1]
2. The same policy says: “For use of NASA images clearances may be necessary for images that include any NASA logos or NASA employees to be used as cover art or in promotional content.” It continues: “Otherwise, NASA imagery can be generally used editorially within published works that are not promotional in nature.”[1]
3. The exact article figure is explicitly described as an **artistic concept** and immediately credited **NASA**. The current RSS item's figure repeats that description and credit and supplies an anchor to the query-free original PNG. Its display `img src` uses `?w=1280`, which is **not** approved or normalized to the original.[2][3]
4. The downloaded original was visually inspected: a NASA insignia is visible on the central robotic arm. No identifiable person or third-party copyright/credit marking was visible. This is not a claim that the insignia is unrestricted. The whole concept may be displayed only as the linked story's informational/editorial illustration, with credit and concept label—not app branding, cover art, advertising, merchandising, promotion, extracted logo use, or implied NASA endorsement.[1][2][4]
5. The policy excludes third-party material: NASA's use grants others no rights to it. Other NASA imagery, including the previously rejected third-party brewery/search-and-rescue candidates and Guam's MAXAR imagery, gains no permission. No NASA AI permission was added; private AI authorization remains denied.[1]

**Assessment:** defensible narrow informational/editorial reuse under the policy's express terms for this NASA-credited concept. This is an application-side review, **not separate written NASA approval or an endorsement**. Any promotional/branding reuse, uncertain new credit, changed bytes or different item requires a new review and must not inherit this approval.

### Exact approved transport identity

| Field | Value |
|---|---|
| Item GUID | `https://www.nasa.gov/?post_type=press-release&p=1045129` |
| Item URL | `https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/` |
| Original asset URL | `https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png` |
| Original response | HTTP 200, same destination, `image/png` |
| Original size | **4,620,791 bytes**, **1280 × 720** |
| Original SHA-256 | `d2775cd0953b366fcf847d1910c3108614d0310ab18e17a26a1d1914d2ea83de` |
| Credit | **NASA** |
| Evidence | Exact article figure, matching supplied RSS figure, NASA media policy, original bytes and visual inspection |

The catalog caption begins **“Artistic concept … not a photograph”**, requires informational/editorial non-endorsing use, and explicitly says the incidental insignia is not licensed for app branding or promotion. Existing row/reader paths carry credit and caption; proportional decoding preserves the full concept. Native display remains for the parent's verification.

### Enforcement

- Existing `nasa-exact-assets-v1` policy and compiled allowlist; exactly **one** appended asset. All **six prior approvals** across NASA/MIT/ESA/Fed were programmatically compared to the pre-change catalog and remain identical; seven total now. NASA's two prior assets remain in their original order.
- Only NASA permission notes, review timestamp and the appended rights-policy entry changed in the catalog. No source flag, sectionScope, endpoint, refresh cadence, AI permission, access mode, existing pin or dependency changed.
- NASA PNG schema support retains the **5 MiB** image ceiling and mandatory lowercase SHA-256; it does not enable PNG for unrelated MIT/ESA rules, SVG, arbitrary formats or unsigned approvals.
- Transient bounded RSS `content:encoded` inspection accepts only the compiled exact item GUID + item URL + literal original-asset anchor `<a href="APPROVED_URL">`. No article fetch, generic scraping, URL guessing, invented enclosure or query stripping. The reviewed fixture is a single **actual retrieved RSS item**, serialized with namespace aliases; its content and supplied asset references were not invented.
- The anchor check is intentionally narrow: feed HTML changing quoting/attributes may fail closed and require review. A bare URL, srcset-only reference, other anchor target or query-bearing variant does not pass this fallback.
- Private database provenance checks reject wrong-item and wrong-media substitutions, imported grants, and source permission revocation; refresh can restore reviewed proof. Binary loader tests reject wrong MIME, byte count, same-length wrong hash, forged approval and the display-query URL **before network when applicable**.

## Actual targeted verification

Raw combined Rust/live output: `docs/evidence/focus-space-engineering-tests.log`. Retrieved policy/article text, HTTP identities, complete extracted item and original media measurement: `docs/evidence/focus-space-engineering-evidence.json`.

| Command | Actual result |
|---|---|
| `cargo test --lib` | **141 passed, 0 failed, 8 explicitly ignored** |
| `cargo test --test focus_topics --test focus_migration` | **5 + 7 passed** |
| `cargo test --test nasa_focus_live -- --ignored --nocapture` | **1 passed**; production refresh → temporary SQLite → private approval → `Backend::execute(media_load)` |
| `python tests/test_source_catalog.py` | **10 passed** |
| `python scripts/check-v02-sources.py` | **69 total / 58 enabled**, `errors: []` |
| Edition-2021 rustfmt check on changed Rust files | Passed |

Final live record counts were parsed and checked programmatically: **10 unique article URLs, 1 focused article, 2 approved images actually loaded**. The focused article is the lunar concept; Guam remains Others. The live test now fails if the lunar item rotates out or cannot be loaded instead of treating unrelated approved images as success.

Lunar output preview (not original transport): **485,280 bytes**, **640 × 360**, PNG SHA-256 `5e480420af00c253980d316ffb6dfebbba033d2281b27b8e594d9bda175c095a`. The existing Guam image still loaded with original **3,468,255-byte** pin / `9edc61505384e8eff56548e2989b89586c3a568bdd2da136e33a6335ccd81dfa`; its preview remains **494,878 bytes**, **640 × 407**, SHA-256 `5b24cadd66449884174646fe7511b53bd5faffd195d47005caf16b575873b8c5`. Original-byte and transformed-preview integrity are deliberately distinct.

## Exact limitations and handoff

- This is a conservative phrase classifier, not comprehensive semantic understanding. Nine current NASA items still classify Others, including some ordinary-language technology stories; no blanket feed label or opportunistic Guam change was used to improve coverage.
- Host integration and actual network/decode are proven. **Native WebView rendering, three-focused-publisher screenshots, full release/native rebuild, packaged payload and installer verification belong to the parent and are not claimed here.** No persistent user database was used and the existing video was not played.
- Current-feed availability is time-dependent. Original-byte changes or item rotation must block the live gate, not expand permission.
- Web extraction backend was search-only; browser harness CDP was unavailable. Direct HTTP retrieval succeeded for the exact policy/article/feed/original, and the production Rust loader independently succeeded. No fabricated evidence or added app dependencies substituted for unavailable tools.
- Automatic write-tool Rust lint assumed Rust 2015; actual Cargo compilation and explicit edition-2021 formatting are authoritative.
- No commits or pushes. The repository already had extensive untracked application files; changes below are this task's files, not a clean-base git diff.
- Mission Control research capture is handed to the parent/commander with this finished report. The requested `.Codex/rules/common/research-capture.md` is absent; the discovered `Desktop/claude-harness-config/rules/common/research-capture.md:7–8` explicitly assigns subagent report posting to the commander.

## Files changed or created

Modified:
- `src-tauri/src/topics.rs`
- `src-tauri/src/rights.rs`
- `src-tauri/src/services.rs`
- `resources/sources.json`
- `scripts/check-v02-sources.py`
- `tests/test_source_catalog.py`
- `src-tauri/tests/focus_topics.rs`
- `src-tauri/tests/focus_migration.rs`
- `src-tauri/tests/rights/rights_classifier.rs`
- `src-tauri/tests/rights/rights_database.rs`
- `src-tauri/tests/media/fed_diagram.rs` (shared pinned-PNG negative harness now also tests NASA)
- `src-tauri/tests/nasa_focus_live.rs`

Created:
- `src-tauri/tests/fixtures/nasa-lunar-technologies.xml`
- `docs/evidence/focus-space-engineering-evidence.json`
- `docs/evidence/focus-space-engineering-tests.log`
- `docs/focus-space-engineering-fix.md`

## Sources

[1] https://www.nasa.gov/nasa-brand-center/images-and-media
[2] https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies
[3] https://www.nasa.gov/technology/feed
[4] https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png
