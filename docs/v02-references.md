# v0.2 extension references — pinned inspection

Reviewed 2026-09-23 UTC. Research only: no upstream code/assets copied, no dependency installed, no source catalog changed. `graphify-out/GRAPH_REPORT.md` was read first; its `a8540546` base matches local HEAD `a85405469939361f2512266ee3f4b21240ac7e8e` (the working tree contains substantial uncommitted application files, so matching HEAD does not prove graph freshness for every file).

## FinceptTerminal: attribution, revision and licensing boundary

- Project/creator: **Fincept Corporation and FinceptTerminal contributors**, https://github.com/Fincept-Corporation/FinceptTerminal.
- Inspected revision: **`b7d850b49dc033bb133e6e5d2476444ac5c422b1`**, resolved from `main`; commit message `Quantcept update`, commit timestamp `2026-09-19T12:41:43Z`.[1]
- The recursive GitHub tree was complete (`truncated:false`). Relevant implementation at this revision is **Qt/C++ under `fincept-qt/`**, not a React/Tauri implementation to transplant.[8][21]
- **License conflict, not MIT:** root `LICENSE` begins with AGPL v3-or-later grant language, then adds a dual-licensing notice claiming commercial/internal use requires a commercial license. At the very same revision, `docs/COMMERCIAL_LICENSE.md` v3.0 says the repository is AGPL-3.0-or-later only, the prior dual-licensing arrangement is discontinued, and Enterprise is a separate product. These statements are inconsistent. Do not simplify this to an unqualified permissive license or assert the conflict has been resolved.[19][20]
- **Decision:** behavioral/conceptual reference only. No code, styles, images, screenshots, icons, translations, presets or other assets copied into the MIT app. Obtain upstream clarification and legal review before any future reuse; attribution alone does not satisfy copyleft or resolve contradictory grants. This research does not certify license compatibility.

### Exact feature paths and what they really show

All paths below were fetched successfully at the full revision above. Citation URLs are immutable raw-file links. Line ranges refer to that fetched revision, not current `main`.

| Need | Exact path and evidence | Transferable idea / explicit limit |
|---|---|---|
| Dense news workspace | `fincept-qt/src/screens/news/NewsScreen.cpp`, lines 76–105: horizontal side panel/feed/detail arrangement; lines 137–149 and 205–215: refresh cadence persisted in minutes | Independent panes and explicit cadence. A 500 ms animation timer is **not** a 500 ms news source.[21] |
| Source text versus AI text | `fincept-qt/src/screens/news/NewsDetailPanel.cpp`, lines 157–162 and 329–333: feed summary and AI summary rendered as plain text in separate areas | Keep original excerpts distinct from generated output; model output and feed markup are untrusted. Do not inherit upstream permission assumptions.[22] |
| RSS/Atom parsing | `fincept-qt/src/services/news/NewsService_Parsing.cpp`, `parse_rss_xml`, lines 40–128; summary extraction includes `description`, `summary`, `encoded` | Reference for namespace/date handling only. Do **not** import its fallback to `content:encoded` into News Terminal's excerpt-only storage policy.[24] |
| Streaming connection state | `fincept-qt/src/services/news/NewsService_LiveFeed.cpp`, `connect_live_feed`, `disconnect_live_feed`, `is_live_connected`; lines 150–155 derive `/ws/news` from its configured backend | Separate connected/disconnected state, reconnect and article dedupe. This is **not evidence of a public, free Fincept news API entitlement**. Use documented HN/Bluesky services instead.[23] |
| Video workspace | `fincept-qt/src/screens/dashboard/widgets/VideoPlayerWidget.cpp`, channel list, `play_url`, `resolve_youtube_and_play`, `play_direct` | Channel chooser plus player is a useful interaction reference. **Reject its yt-dlp subprocess path** (lines 280–303) and hard-coded broadcaster stream IDs. News Terminal should use official watch links, compliant player integration if separately reviewed, or explicitly permitted direct media.[28] |
| Headline digest | `fincept-qt/src/services/news/NewsService.cpp`, `summarize_headlines`, lines 507–550, posts headline array to `/news/summarize`; `NewsScreen.cpp` lines 265–276 wires the button | This is a backend-dependent headline summarizer, not a keyless AI service or proof of daily scheduled sector briefings. Never call Fincept's backend without authorization.[54][21] |
| Daily briefing reference | `fincept-qt/src/services/report_builder/ReportBuilderTemplates.cpp`, `apply_template_to_service`, lines 169–191: `Daily Market Brief` | Actual template contains Market Overview, Sector Performance, Key Events & News and Commentary. Its sector returns are **hard-coded example values**, and news text is an input placeholder. Do not display these as actual market data or claim the template is an automatic daily news digest.[31] |
| Native multiwindow registry | `fincept-qt/src/core/window/WindowRegistry.cpp`, `register_frame`, `unregister_frame`, `frames`, `frame_ids` | Track stable windows independently from tab/panel state. Qt implementation is not a drop-in Tauri component.[29] |
| Multi-monitor operations | `fincept-qt/src/mcp/tools/WorkspaceTools_MonitorsWindows.cpp`, `register_monitor_window_tools`: `list_monitors`, `new_window`, `move_window_to_monitor`, `set_window_geometry`, topology inspection | Monitor identity/geometry and window operations are real code references, not merely screenshot inference. Native negative-coordinate, DPI and hot-unplug tests are still required in our app.[30] |
| Workspace restoration | `fincept-qt/src/core/layout/WorkspaceShell.cpp`, `capture`, `apply`, `load_last_or_default` | Persist a workspace separately from transient focus; recover when displays change. News Terminal must implement this with its own window/IPC ownership rules.[32] |

## Recommended original v0.2 extension boundary

These are recommendations, **not implemented or verified app features**:

1. Keep Tauri/Rust/SQLite/React. Use the already documented Tauri native-window references in `docs/references.md`; do not migrate to Qt or add a docking framework merely to imitate a screenshot.
2. Make **News / Social / Media / Daily Brief / Source Health** independently detachable panels. Show source, publication time, first-seen time, transport and stale/error state everywhere. Multi-monitor layouts may share one backend state rather than duplicate ingestion per window.
3. Add a deterministic sector briefing first: time-bounded source-backed headline groups, source diversity caps, links, explicit empty sectors. Separate optional rights-gated AI prose; no fabricated prices/returns, market coverage guarantees or automatic claims of corroboration.
4. Keep stream and RSS adapters separate. A one-second UI clock or event flush cadence is not a one-second publisher polling contract. The live proof and concrete source contracts are in `v02-source-research.md`.
5. Treat image access, video playback, caching and AI use as distinct permissions. Preserve current `aiAllowed:false` values until a separately reviewed implementation supports item-level provenance/exclusions. No thumbnail or player should create hidden page scraping.

## Research capture and reproducibility

`C:/Users/user/.Codex/rules/common/research-capture.md` was not found; searching `.Codex` returned no such file. The referenced `C:/Users/user/Documents/Codex/mission-control` path was also absent. **Mission Control Research posting is blocked and was not performed**; no `mc_post.py` command or destination was guessed. This file and `v02-source-research.md` are the deliverables to capture when the rule/tool becomes available.

To repeat reference inspection: resolve the repository default branch commit, fetch its recursive tree, then fetch each exact path and both licensing documents by full SHA. Read the actual files; repository description/license badges and old React-path assumptions are insufficient. No upstream build or executable was run.

## Sources

[1] https://api.github.com/repos/Fincept-Corporation/FinceptTerminal/commits/main
[8] https://api.github.com/repos/Fincept-Corporation/FinceptTerminal/git/trees/b7d850b49dc033bb133e6e5d2476444ac5c422b1?recursive=1
[19] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/LICENSE
[20] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/docs/COMMERCIAL_LICENSE.md
[21] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/screens/news/NewsScreen.cpp
[22] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/screens/news/NewsDetailPanel.cpp
[23] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/services/news/NewsService_LiveFeed.cpp
[24] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/services/news/NewsService_Parsing.cpp
[28] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/screens/dashboard/widgets/VideoPlayerWidget.cpp
[29] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/core/window/WindowRegistry.cpp
[30] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/mcp/tools/WorkspaceTools_MonitorsWindows.cpp
[31] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/services/report_builder/ReportBuilderTemplates.cpp
[32] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/core/layout/WorkspaceShell.cpp
[54] https://raw.githubusercontent.com/Fincept-Corporation/FinceptTerminal/b7d850b49dc033bb133e6e5d2476444ac5c422b1/fincept-qt/src/services/news/NewsService.cpp
