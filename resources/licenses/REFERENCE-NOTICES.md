# Third-party notices and reference inventory

Reference research reviewed 2026-09-23 UTC. **Resolved dependency reconciliation is now available in [`resources/licenses/README.md`](resources/licenses/README.md) and [`resources/licenses/inventory.json`](resources/licenses/inventory.json). This is not a legal-compliance certification or a complete binary-distribution SBOM.** The generated inventory is tied to SHA-256 fingerprints of the actual npm/Cargo manifests and lockfiles; regenerate it whenever those inputs change. The original reference-only research below is retained separately from adopted dependencies.

## Resolved dependency bundle

- **555 package/version entries:** all **549 third-party Cargo lock entries**, **5 npm production dependency entries** (including transitive `scheduler`), and **1 Vite build-tool supplement** because Vite can emit runtime modulepreload helper code. The **158 other npm dev-only lock entries** are explicitly listed as excluded in the JSON inventory.
- Cargo intentionally overincludes build/dev and non-Windows dependencies. For `x86_64-pc-windows-msvc`, **333** entries are in the normal-edge dependency closure, **23** are additional build/dev entries, and **193** are other-target/resolved-optional supplements. Normal-edge membership includes procedural macros; these counts are not a binary link map.
- **978 upstream license/notice references** and **49 supporting evidence references** are captured. The **349 deduplicated, byte-exact text blobs** are under `resources/licenses/texts/`; **34 additional upstream/source artifacts** are under `upstream/` and `sources/`. The inventory maps copies to source paths, SHA-256 hashes and immutable upstream revision/package provenance. Nested notices are retained even where they concern unused code. Declared authors are metadata, not inferred copyright holders.
- The Windows image-preview dependency **`image` 0.25.10** is included with its declared **MIT OR Apache-2.0** expression and exact upstream `LICENSE-MIT` and `LICENSE-APACHE` texts. Its resolved codec dependencies are also represented in the generated inventory.
- **All 12 originally missing Windows normal/build license-text gaps are resolved; no Windows-scope or included npm entry lacks a full named license text or license declaration.** Eleven packages use full upstream project license files at their own published `.cargo_vcs_info.json` revisions. `selectors` uses the full official Mozilla MPL-2.0 text explicitly incorporated by its published source header; its Git repository had no full MPL text. No copyright notice was invented. `upstream/manifest.json` records this distinction.
- **30 missing-text entries remain**, all outside the selected Windows closure as other-target/resolved-optional supplements. These entries are not established as distributed by this Windows build, are individually reported, and are not silently waived for another platform or feature selection. `--strict-windows` passes; the all-target `--strict` intentionally still fails. This is a notice-evidence gate, not a binary compliance certification.
- **Five MPL source archives are included**, for `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext` and `selectors`, separately from reference-only TimelineJS3. [`SOURCE-NOTICE.md`](resources/licenses/SOURCE-NOTICE.md) tells recipients how to obtain the included exact source and MPL license; it also records versioned downloads/checksums. The offline generator verifies each archive against Cargo.lock and each member against the actual resolved Cargo source, rejecting modifications or extra source files. Preserve the notice and archives with every binary distribution. See [`DISTRIBUTION-REVIEW.md`](resources/licenses/DISTRIBUTION-REVIEW.md) for obligations and remaining installer gates.
- `libsqlite3-sys`'s MIT wrapper notice and the bundled SQLite amalgamation's public-domain dedication are separate preserved evidence. `ring`'s nested upstream licenses are retained. `lucide-react`'s upstream ISC notice includes attribution to Cole Bemis/Feather (MIT); the short declared-license field is not a substitute for those texts.
- **Actual WebView2 loader SDK terms are now included**, separate from the Rust wrapper MIT license. The exact crate update-tool revision identifies Microsoft.Web.WebView2 **1.0.3650.58**. All nine loader DLL/import/static-library files match the official NuGet package byte-for-byte. Its full Microsoft LICENSE.txt, NOTICE.txt and `.nuspec` are preserved in `upstream/webview2-sdk/`; hashes and provenance are recorded. The separate WebView2 Runtime/bootstrapper, VC runtime and installer payload remain release-specific audit gates, not covered by the loader SDK conclusion.

The original application [`LICENSE`](LICENSE), **Copyright (c) 2026 Skytuhua**, is unchanged; its exact bytes are copied to `resources/licenses/APPLICATION-LICENSE.txt`. This document is also copied to `resources/licenses/REFERENCE-NOTICES.md` for bundling. Package notices do not replace either the original application notice or publisher/creator rights.

Reproduce with Python 3.11+ (standard library only), installed npm packages, and a populated Cargo registry cache:

```sh
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
python scripts/license-notices.py
python scripts/license-notices.py --check --strict-windows
python scripts/license-notices.test.py
```

The generator/checker runs `cargo metadata --locked --offline` for the full graph and Windows scope; it performs no network fetch or dependency modification. Installation/fetch prerequisites may access registries. `--check` reconstructs and byte-compares the bundle and hash-checks reviewed supplemental inputs; `--strict-windows` rejects applicable Windows/npm gaps and `--strict` additionally fails on the thirty remaining all-target gaps. `scripts/license-notices-fetch.py` is the separate, explicit online evidence/source acquisition tool, not part of the offline check. Both missing packages and installed npm version mismatches fail generation. Full license text must accompany attribution; this index alone is not the license bundle.

## v0.2 packaging and reference boundary

The release tooling refresh uses the existing offline dependency/notice generator;
no substitute license text or copyright holder was invented. The existing
`base64` crate remains represented by its resolved package/version and original
license texts in the inventory; making it a direct application dependency does
not create a second package notice. Root version/lockfile edits still change the
input fingerprints, so regenerate and run `--check --strict-windows` **after** the
release owner finishes those edits and **before** the final build.

FinceptTerminal (Fincept Corporation and contributors) is a **behavioral and
conceptual reference only**, not an adopted dependency. The pinned review at
`b7d850b49dc033bb133e6e5d2476444ac5c422b1` documents conflicting AGPL/dual-licensing
statements; this project does not resolve that conflict or call the reference MIT.
No code, styles, images, icons, presets, translations or other assets are to be
copied under this reference decision. See the immutable license/document links
and precise boundary in [`docs/v02-references.md`](docs/v02-references.md).
Attribution is not permission to incorporate incompatible material.

The repository-local Ollama runtime, model, machine-local notices and setup/run
scripts are separate from the app distributions. Release policy excludes
`.local-ai`, Ollama, weights and runtime helper scripts from both NSIS and the
portable app/notices ZIP; inspection must verify this for each final artifact.
See [`docs/installer-payload.md`](docs/installer-payload.md) for the fresh-payload
gates and [`docs/local-ai.md`](docs/local-ai.md) for the separate machine setup.
The software notices do not grant publisher-content, social-post, video, image,
or AI-processing rights. Those remain governed by the application's separately
reviewed source policy and item-level permissions.

## Application and publisher content

The application's own licence does not relicense publisher feeds, user comments, government seals, third-party images or model weights. Consult `docs/source-policy.md` and `docs/sources.md` before enabling content/AI use. Source names and trademarks identify their owners and do not imply endorsement. No publisher article bodies, feed response dumps, logos, fonts or model weights were added to the repository by this assignment.

## Focused metadata panels

The OpenRouter model panel uses public model metadata only and does not run inference. Benchmark panels keep source data separate: Arena leaderboard dataset rows are labelled CC BY 4.0, and SWE-bench leaderboard rows are labelled CC BY-NC 4.0. These notices do not grant permission to merge benchmark metrics into a universal ranking or to use noncommercial data commercially.

## Reference-only projects

The immutable licence/code evidence is in `docs/references.md`. Except for this notice text and evidence pointers, no implementation from these references was transplanted by this assignment. Listing a reference does not assert it is in the shipped executable.

| Project / creator | Reviewed upstream licence | Status |
|---|---|---|
| tauri-apps/tauri / Tauri Apps contributors | Apache-2.0 OR MIT | Reference; check final dependency inventory separately |
| tauri-apps/plugins-workspace / Tauri Apps contributors | Apache-2.0 OR MIT | Reference; check final dependency inventory separately |
| miniflux/v2 / Miniflux contributors | Apache-2.0 | Reference; check final dependency inventory separately |
| FreshRSS/FreshRSS / FreshRSS contributors | AGPL-3.0 | Behavioral-only; no code/assets copied |
| RSSNext/Folo / RSSNext / Folo contributors | AGPL-3.0 | Behavioral-only; no code/assets copied |
| continuedev/continue / Continue contributors | Apache-2.0 | Reference; check final dependency inventory separately |
| ollama/ollama / Ollama contributors | MIT | Reference; check final dependency inventory separately |
| scikit-learn/scikit-learn / scikit-learn developers | BSD-3-Clause | Reference; check final dependency inventory separately |
| recommenders-team/recommenders / Microsoft Corporation and Recommenders contributors | MIT | Reference; check final dependency inventory separately |
| NUKnightLab/TimelineJS3 / Northwestern University Knight Lab contributors | MPL-2.0 | Behavioral-only; no code/assets copied |
| benfred/implicit / Ben Frederickson / implicit contributors | MIT | Reference; check final dependency inventory separately |

FreshRSS and Folo are **AGPL behavioral references only**; the project must not silently absorb their code or assets. TimelineJS3 is an MPL conceptual reference only. A translated/ported implementation can still be derived code; changing languages is not a licence workaround.

## Tauri upstream MIT notice (reference copy)

The following exact notice was retrieved from the Tauri revision pinned in `docs/references.md`. It is provided for attribution; it is not evidence that the final resolved dependency version matches this research revision. Tauri also publishes an Apache-2.0 alternative.[54][53]

```text
MIT License

Copyright (c) 2017 - Present Tauri Apps Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Release licence checklist — reconciliation and remaining gates

1. **Windows missing-text evidence resolved; installer verification remains open.** Exact resolved versions, sources, declared expressions, full upstream licence/NOTICE texts, source archives and lock fingerprints are captured in `resources/licenses/`. Original copyright notices are preserved rather than inferred from author metadata. Ship the complete bundle, verify its installed accessibility, and re-run generation/checking against final release lockfiles. Resolve the thirty other-target/optional gaps before distributing those packages on an applicable target.
2. Inspect bundled WebView/native DLLs, icons/fonts, installer resources and any included runtime/model separately. Operating-system prerequisites are not automatically redistributed components.
3. For Apache-2.0 material, preserve applicable notices and mark modifications; do not replace an upstream NOTICE with this project's short table.[53]
4. For MIT/BSD material, include required copyright/permission/disclaimer text in the distribution.[54][70]
5. Do not ship AGPL-derived code/assets or MPL-covered modifications under an assumed MIT-only notice. Resolve source/notice obligations before adoption.[62][64][75]
6. Review source-policy gates and package no publisher content beyond verified permitted scope. AI-model licences and publisher content rights remain separate from software licences.

No commit, push, release, API purchase or Mission Control publication was performed by this assignment. The required Mission Control capture rule was absent, so publication was not attempted to a guessed endpoint.

## Sources

[53] https://raw.githubusercontent.com/tauri-apps/tauri/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-APACHE-2.0
[54] https://raw.githubusercontent.com/tauri-apps/tauri/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-MIT
[62] https://raw.githubusercontent.com/FreshRSS/FreshRSS/64f7f24c6e2c72968c2e7b7f1983ac0a71186481/LICENSE.txt
[64] https://raw.githubusercontent.com/RSSNext/Folo/fac0b0832a2f69de0aef3c19a3e54e22673e37de/LICENSE
[70] https://raw.githubusercontent.com/scikit-learn/scikit-learn/4c0c55701eded1f9e4fbbc51ec90a543288610b2/COPYING
[75] https://raw.githubusercontent.com/NUKnightLab/TimelineJS3/12a80199b967394a020f8faa7b001162a71e2494/LICENSE
