# Feature references and licence boundaries

Reviewed 2026-09-23 UTC. These are **research references, not installed dependency versions**. GitHub API resolved each default branch to the full commit below; each named path and licence was then fetched from `raw.githubusercontent.com` at that commit. All fetched reference paths returned HTTP 200. This does not mean tests, builds or examples from those repositories were executed.

No code or assets were copied from the AGPL FreshRSS/Folo references. No repository was cloned into the application and no dependency was added in this assignment. Small function names/path descriptions below are evidence pointers, not implementation transplantation.

## Native windows / detach primitives

- Creator/project: **Tauri Apps contributors** — [tauri-apps/tauri](https://github.com/tauri-apps/tauri).
- Immutable revision: `023fe7f59650c50b624021460064ee074bda56d9`.
- Reviewed licence: **Apache-2.0 OR MIT**.[53][54]
- Relevant evidence: `WebviewWindowBuilder::new` / `build`, `current_monitor`, `available_monitors` in `crates/tauri/src/webview/webview_window.rs` (lines 101, 489, 1936, 1953 in fetched revision).[55]
- Use boundary: Native API reference only. App tab ownership, IPC scope and reattach transactions remain original application work.
- Pinned files:
  - [`LICENSE-APACHE-2.0`](https://github.com/tauri-apps/tauri/blob/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-APACHE-2.0)
  - [`LICENSE-MIT`](https://github.com/tauri-apps/tauri/blob/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-MIT)
  - [`crates/tauri/src/webview/webview_window.rs`](https://github.com/tauri-apps/tauri/blob/023fe7f59650c50b624021460064ee074bda56d9/crates/tauri/src/webview/webview_window.rs)

## Window persistence / monitor recovery

- Creator/project: **Tauri Apps contributors** — [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace).
- Immutable revision: `1cae06a55b3398d409fba5ac17dbac63d9cf7652`.
- Reviewed licence: **Apache-2.0 OR MIT**.[56][57]
- Relevant evidence: `plugins/window-state/src/lib.rs`: `save_window_state`, `restore_state`; restore logic examines `available_monitors` (lines 131, 183, 209–211).[58]
- Use boundary: Behavior/API reference, not a claim the plugin is installed. Monitor/DPI edge cases need native tests; the library does not persist app profile/tab state.
- Pinned files:
  - [`plugins/window-state/LICENSE_APACHE-2.0`](https://github.com/tauri-apps/plugins-workspace/blob/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/LICENSE_APACHE-2.0)
  - [`plugins/window-state/LICENSE_MIT`](https://github.com/tauri-apps/plugins-workspace/blob/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/LICENSE_MIT)
  - [`plugins/window-state/src/lib.rs`](https://github.com/tauri-apps/plugins-workspace/blob/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/src/lib.rs)

## RSS/Atom / unread state

- Creator/project: **Miniflux contributors** — [miniflux/v2](https://github.com/miniflux/v2).
- Immutable revision: `4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4`.
- Reviewed licence: **Apache-2.0**.[59]
- Relevant evidence: `internal/reader/atom/parser.go`: `Parse`; `internal/model/entry.go`: status constants, `NewEntry`, `ShouldMarkAsReadOnView`, update patch.[60][61]
- Use boundary: Reader semantics and parser behavior reference. Do not copy its full-text scraping paths into this excerpt-only app; no Go dependency adopted.
- Pinned files:
  - [`LICENSE`](https://github.com/miniflux/v2/blob/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/LICENSE)
  - [`internal/reader/atom/parser.go`](https://github.com/miniflux/v2/blob/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/internal/reader/atom/parser.go)
  - [`internal/model/entry.go`](https://github.com/miniflux/v2/blob/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/internal/model/entry.go)

## Read/favorite/category reader comparison

- Creator/project: **FreshRSS contributors** — [FreshRSS/FreshRSS](https://github.com/FreshRSS/FreshRSS).
- Immutable revision: `64f7f24c6e2c72968c2e7b7f1983ac0a71186481`.
- Reviewed licence: **AGPL-3.0**.[62]
- Relevant evidence: `app/Models/Entry.php`: `isRead`, `is_favorite`, feed ID and last-seen/modified fields.[63]
- Use boundary: Behavioral comparison ONLY. No AGPL source, translation, style, image or asset transplantation into the MIT application.
- Pinned files:
  - [`LICENSE.txt`](https://github.com/FreshRSS/FreshRSS/blob/64f7f24c6e2c72968c2e7b7f1983ac0a71186481/LICENSE.txt)
  - [`app/Models/Entry.php`](https://github.com/FreshRSS/FreshRSS/blob/64f7f24c6e2c72968c2e7b7f1983ac0a71186481/app/Models/Entry.php)

## Dedicated discussion/social presentation

- Creator/project: **RSSNext / Folo contributors** — [RSSNext/Folo](https://github.com/RSSNext/Folo).
- Immutable revision: `fac0b0832a2f69de0aef3c19a3e54e22673e37de`.
- Reviewed licence: **AGPL-3.0**.[64]
- Relevant evidence: `apps/mobile/src/modules/entry-list/EntryListContentSocial.tsx`: `EntryListContentSocial` and its separate social list presentation.[65]
- Use boundary: Behavioral comparison ONLY; it is a mobile social-list reference, not proof of this app native desktop windows. No copied code/assets.
- Pinned files:
  - [`LICENSE`](https://github.com/RSSNext/Folo/blob/fac0b0832a2f69de0aef3c19a3e54e22673e37de/LICENSE)
  - [`apps/mobile/src/modules/entry-list/EntryListContentSocial.tsx`](https://github.com/RSSNext/Folo/blob/fac0b0832a2f69de0aef3c19a3e54e22673e37de/apps/mobile/src/modules/entry-list/EntryListContentSocial.tsx)

## AI provider adapter / cancellation

- Creator/project: **Continue contributors** — [continuedev/continue](https://github.com/continuedev/continue).
- Immutable revision: `5522c6f44ca0ac3528b37244818fbfa39b5af470`.
- Reviewed licence: **Apache-2.0**.[66]
- Relevant evidence: `core/llm/llms/Ollama.ts`: adapter methods accept `AbortSignal` (e.g. lines 419, 498).[67]
- Use boundary: Interface/cancellation reference only. Provider consent, source rights, quota policy and user-visible fallback must be implemented and tested separately.
- Pinned files:
  - [`LICENSE`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/LICENSE)
  - [`core/llm/llms/Ollama.ts`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts)

## Optional local AI request contract

- Creator/project: **Ollama contributors** — [ollama/ollama](https://github.com/ollama/ollama).
- Immutable revision: `b9cd4b1efbbf7bd1b9d202baafc64f0ebe63970e`.
- Reviewed licence: **MIT**.[68]
- Relevant evidence: `api/types.go`: `GenerateRequest`, `ChatRequest`, optional `Stream` field (lines 62, 84, 133, 141).[69]
- Use boundary: External service integration reference, not a bundled server/model. Model-weight licences, installation and source AI rights are separate.
- Pinned files:
  - [`LICENSE`](https://github.com/ollama/ollama/blob/b9cd4b1efbbf7bd1b9d202baafc64f0ebe63970e/LICENSE)
  - [`api/types.go`](https://github.com/ollama/ollama/blob/b9cd4b1efbbf7bd1b9d202baafc64f0ebe63970e/api/types.go)

## Conservative title similarity / clustering

- Creator/project: **scikit-learn developers** — [scikit-learn/scikit-learn](https://github.com/scikit-learn/scikit-learn).
- Immutable revision: `4c0c55701eded1f9e4fbbc51ec90a543288610b2`.
- Reviewed licence: **BSD-3-Clause**.[70]
- Relevant evidence: `sklearn/feature_extraction/text.py`: `TfidfVectorizer`; `sklearn/cluster/_agglomerative.py`: `AgglomerativeClustering`.[71][72]
- Use boundary: Algorithm/evaluation reference, not a dependency or a transplanted classifier. Begin with simple title/time rules, negative fixtures and manual splits; similarity is not event identity.
- Pinned files:
  - [`COPYING`](https://github.com/scikit-learn/scikit-learn/blob/4c0c55701eded1f9e4fbbc51ec90a543288610b2/COPYING)
  - [`sklearn/cluster/_agglomerative.py`](https://github.com/scikit-learn/scikit-learn/blob/4c0c55701eded1f9e4fbbc51ec90a543288610b2/sklearn/cluster/_agglomerative.py)
  - [`sklearn/feature_extraction/text.py`](https://github.com/scikit-learn/scikit-learn/blob/4c0c55701eded1f9e4fbbc51ec90a543288610b2/sklearn/feature_extraction/text.py)

## Diversity / coverage evaluation

- Creator/project: **Microsoft Corporation and Recommenders contributors** — [recommenders-team/recommenders](https://github.com/recommenders-team/recommenders).
- Immutable revision: `0bb4b3690941ffb668118e31ccaf8a7d19f8212a`.
- Reviewed licence: **MIT**.[73]
- Relevant evidence: `recommenders/evaluation/python_evaluation.py`: `diversity`, `serendipity`, `catalog_coverage` and item-similarity evaluation.[74]
- Use boundary: Evaluation definitions only; not a claim of political neutrality, independent ownership verification or working recommendations. No model runtime adopted.
- Pinned files:
  - [`LICENSE`](https://github.com/recommenders-team/recommenders/blob/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/LICENSE)
  - [`recommenders/evaluation/python_evaluation.py`](https://github.com/recommenders-team/recommenders/blob/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/recommenders/evaluation/python_evaluation.py)

## Timeline date model / ordering

- Creator/project: **Northwestern University Knight Lab contributors** — [NUKnightLab/TimelineJS3](https://github.com/NUKnightLab/TimelineJS3).
- Immutable revision: `12a80199b967394a020f8faa7b001162a71e2494`.
- Reviewed licence: **MPL-2.0**.[75]
- Relevant evidence: `src/js/core/TimelineConfig.js`: `start_date`, `end_date`, `sortByDate`, `addEvent`; `src/js/timeline/Timeline.js` coordinates the timeline.[76][77]
- Use boundary: Conceptual reference ONLY. Do not import MPL-covered code without file-level licence compliance. Publisher update time, first-seen time and event time are separate app concepts, not automatically supplied by this widget.
- Pinned files:
  - [`LICENSE`](https://github.com/NUKnightLab/TimelineJS3/blob/12a80199b967394a020f8faa7b001162a71e2494/LICENSE)
  - [`src/js/timeline/Timeline.js`](https://github.com/NUKnightLab/TimelineJS3/blob/12a80199b967394a020f8faa7b001162a71e2494/src/js/timeline/Timeline.js)
  - [`src/js/core/TimelineConfig.js`](https://github.com/NUKnightLab/TimelineJS3/blob/12a80199b967394a020f8faa7b001162a71e2494/src/js/core/TimelineConfig.js)

## Recommendation explanations

- Creator/project: **Ben Frederickson / implicit contributors** — [benfred/implicit](https://github.com/benfred/implicit).
- Immutable revision: `8a95dbe24ca675a6edd86aafb3b4cd5ae7287edf`.
- Reviewed licence: **MIT**.[81]
- Relevant evidence: `implicit/cpu/als.py`: `AlternatingLeastSquares.explain` exposes contributing items and weights.[82]
- Use boundary: Conceptual reference for explaining actual score contributions, not a dependency. Our deterministic rule reasons must name the actual matched topic/keyword/source/recency rule; do not pretend ALS was run.
- Pinned files:
  - [`LICENSE`](https://github.com/benfred/implicit/blob/8a95dbe24ca675a6edd86aafb3b4cd5ae7287edf/LICENSE)
  - [`implicit/cpu/als.py`](https://github.com/benfred/implicit/blob/8a95dbe24ca675a6edd86aafb3b4cd5ae7287edf/implicit/cpu/als.py)

## Mapping boundaries and original work

The citations identify real feature-specific symbols; they do not imply any one reference implements the whole News Terminal contract. In particular:

- Source licensing/AI gates, profile isolation, feed-excerpt retention, source-diversity limits, quiet hours, previous-visit watermark, revision provenance and cross-window transaction rules are application-specific requirements, not obtained by citing a reader repository.
- `TfidfVectorizer` and clustering are optional conceptual baselines, not a mandate for Python, embeddings, a model service or a vector database. Keep the Rust heuristic small unless measured failure warrants complexity.
- Diversity metrics are not factual source-independence or bias labels. A fixed source cap can be explained directly without a recommendation ML package.
- TimelineJS illustrates explicit dates and ordering; it does not prove that a publication update reflects a real-world event time or correction.
- Continue/Ollama illustrate request/cancellation contracts, not free-tier guarantees or permission to send publisher text.
- The Tauri window-state reference does not verify mixed-DPI/negative-coordinate behavior on this machine. Parent integration owns native acceptance tests.

## Licence handling

Reference-only reading is separate from redistribution. If later work adopts code/assets, record the exact file/revision, modifications and full applicable notices in `THIRD_PARTY_NOTICES.md` **before** distribution. MIT/BSD require retained notices; Apache-2.0 adds its licence/NOTICE/change-marking conditions.[54][70][53]

MPL-2.0 has covered-file source obligations; AGPL reuse requires a deliberate compatible licensing decision rather than copying into an MIT-only app.[75][62][64] Do not infer all transitive dependencies, subdirectories, fonts or model weights share the repository root licence.

The current dependency bill of materials must be generated from the final Cargo/npm lockfiles and actual shipped artefact, not this reference matrix. This assignment did not audit the evolving application dependency graph.

## Sources

[53] https://raw.githubusercontent.com/tauri-apps/tauri/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-APACHE-2.0
[54] https://raw.githubusercontent.com/tauri-apps/tauri/023fe7f59650c50b624021460064ee074bda56d9/LICENSE-MIT
[55] https://raw.githubusercontent.com/tauri-apps/tauri/023fe7f59650c50b624021460064ee074bda56d9/crates/tauri/src/webview/webview_window.rs
[56] https://raw.githubusercontent.com/tauri-apps/plugins-workspace/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/LICENSE_APACHE-2.0
[57] https://raw.githubusercontent.com/tauri-apps/plugins-workspace/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/LICENSE_MIT
[58] https://raw.githubusercontent.com/tauri-apps/plugins-workspace/1cae06a55b3398d409fba5ac17dbac63d9cf7652/plugins/window-state/src/lib.rs
[59] https://raw.githubusercontent.com/miniflux/v2/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/LICENSE
[60] https://raw.githubusercontent.com/miniflux/v2/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/internal/reader/atom/parser.go
[61] https://raw.githubusercontent.com/miniflux/v2/4e6d7f93b2e9c036bd7a0b5299d0bd70f36718b4/internal/model/entry.go
[62] https://raw.githubusercontent.com/FreshRSS/FreshRSS/64f7f24c6e2c72968c2e7b7f1983ac0a71186481/LICENSE.txt
[63] https://raw.githubusercontent.com/FreshRSS/FreshRSS/64f7f24c6e2c72968c2e7b7f1983ac0a71186481/app/Models/Entry.php
[64] https://raw.githubusercontent.com/RSSNext/Folo/fac0b0832a2f69de0aef3c19a3e54e22673e37de/LICENSE
[65] https://raw.githubusercontent.com/RSSNext/Folo/fac0b0832a2f69de0aef3c19a3e54e22673e37de/apps/mobile/src/modules/entry-list/EntryListContentSocial.tsx
[66] https://raw.githubusercontent.com/continuedev/continue/5522c6f44ca0ac3528b37244818fbfa39b5af470/LICENSE
[67] https://raw.githubusercontent.com/continuedev/continue/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts
[68] https://raw.githubusercontent.com/ollama/ollama/b9cd4b1efbbf7bd1b9d202baafc64f0ebe63970e/LICENSE
[69] https://raw.githubusercontent.com/ollama/ollama/b9cd4b1efbbf7bd1b9d202baafc64f0ebe63970e/api/types.go
[70] https://raw.githubusercontent.com/scikit-learn/scikit-learn/4c0c55701eded1f9e4fbbc51ec90a543288610b2/COPYING
[71] https://raw.githubusercontent.com/scikit-learn/scikit-learn/4c0c55701eded1f9e4fbbc51ec90a543288610b2/sklearn/cluster/_agglomerative.py
[72] https://raw.githubusercontent.com/scikit-learn/scikit-learn/4c0c55701eded1f9e4fbbc51ec90a543288610b2/sklearn/feature_extraction/text.py
[73] https://raw.githubusercontent.com/recommenders-team/recommenders/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/LICENSE
[74] https://raw.githubusercontent.com/recommenders-team/recommenders/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/recommenders/evaluation/python_evaluation.py
[75] https://raw.githubusercontent.com/NUKnightLab/TimelineJS3/12a80199b967394a020f8faa7b001162a71e2494/LICENSE
[76] https://raw.githubusercontent.com/NUKnightLab/TimelineJS3/12a80199b967394a020f8faa7b001162a71e2494/src/js/timeline/Timeline.js
[77] https://raw.githubusercontent.com/NUKnightLab/TimelineJS3/12a80199b967394a020f8faa7b001162a71e2494/src/js/core/TimelineConfig.js
[81] https://raw.githubusercontent.com/benfred/implicit/8a95dbe24ca675a6edd86aafb3b4cd5ae7287edf/LICENSE
[82] https://raw.githubusercontent.com/benfred/implicit/8a95dbe24ca675a6edd86aafb3b4cd5ae7287edf/implicit/cpu/als.py
