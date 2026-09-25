# News Terminal 0.2 guide

## The desk

The compact three-pane reader retains profiles, saved stories, search, comparison and detachable tabs. Use **Daily briefing** for a selected local calendar date and sector-by-sector coverage; **Your brief** remains the since-last-visit view. The daily report covers retrieved, profile-matching stories, not every event worldwide. Multi-topic sector counts overlap; undated items are disclosed separately. Empty sectors are coverage gaps, not evidence that nothing happened.

Briefing outlines are source-linked headlines, not AI-generated summaries. Expand optional AI summaries for eligible individual items. Source text remains separate from generated analysis. Model output can be factually wrong, including date comparisons observed during testing; verify important statements against original sources. This is neither an emergency-warning service nor financial advice.

## Images and video

Nothing loads automatically. Use **Load image** or **Load video** in the reading pane. Loading discloses your IP address to the media host. Images and supported MP4/WebM videos are fetched by the Rust host with destination checks and size/time bounds; they do not enable third-party scripts, arbitrary iframes or autoplay.

Permissions are item-specific. The NASA Technology feed currently has two explicitly reviewed, byte-pinned assets associated with one actual story. Other NASA assets, including third-party MAXAR images in that same story, do not inherit permission. Unsupported, oversized, changed or unapproved media remain unavailable in-app; use the original publisher page. YouTube connections are video discovery and original watch links, not downloads or embedded playback. Remote media is not an offline archive or included in backups.

## Live discussion and connections

**Live discussion → Connect** opens one shared Hacker News Firebase SSE connection for all windows. Incoming metadata updates are stream-driven; the interface checks the local status every second. Initial snapshots and transport keep-alives are not new publications. No one-second publication guarantee is made. Reconnect/backoff and last received timestamps remain visible; disconnect clears the stream's in-memory list.

The reviewed catalog has 30 sources, 19 enabled. It includes public Mastodon account RSS, Lemmy community title/link discovery and NASA YouTube channel discovery. Connections also accepts explicitly configured permitted RSS endpoints with terms acknowledgment. These are not authenticated social accounts or permission to scrape arbitrary platforms. Bluesky, Reddit and X remain external-link options, not connected firehoses. RSS refresh intervals, publisher cache instructions and backoff are not bypassed by the live view.

## Local AI on this machine

The separately installed local runtime is under the repository's ignored `.local-ai/` directory. It is not part of the lightweight installer or portable archive. Start it from the repository if it is not already running:

```text
python scripts/local-ai-run.py
```

In AI settings choose **Use local AI**. The app verifies the exact installed `qwen3:4b-instruct-2507-q4_K_M` model at `http://127.0.0.1:11434`. No key, paid account or cloud fallback is enabled by this action. The initial machine setup and inference evidence are documented in `local-ai.md`. The runtime is not registered as a Windows service or login startup task.

The user-requested local runtime is available on this development machine; a fresh installation on another machine still needs its own local model setup or an explicitly configured supported provider. Provider consent and source rights are separate. Government-feed eligibility is narrowly classified; NASA/social content is not AI-enabled. Imports intentionally invalidate processing grants until trusted content is refreshed or a custom source is explicitly reauthorized.

## Multiple screens

Detach a workspace tab, then use **Screens** in that window to choose a physical monitor and Full, Left or Right. Only the invoking window moves. The main and detached windows support the same controls and persist ownership and restore geometry. Small half-screen targets may be rejected when they cannot fit the minimum readable window size; the prior placement is preserved. Missing-monitor recovery is supported, but a display rearrangement invalidates previously listed topology IDs—refresh the monitor list.

Real debug-native testing covered three physical monitors, negative x coordinates and mixed 100%/150% DPI. An above-primary display and physical hot-unplug were not tested. Final-release evidence is recorded separately from debug and browser fixtures.

## Distribution and verification

The 0.2 release must pass fresh root checks, installer payload inspection and smoke tests against the extracted packaged executable. See `docs/evidence/release-checks.json`, `installer-payload.json`, `v02-reader-release.json` and the versioned monitor evidence for actual results; this guide is not a substitute for those records. Browser fixtures are explicitly distinct from real feed/native tests.

The application remains unsigned, and requires an already-installed WebView2 runtime. Alerts require the app process to stay running. Source coverage/access and permissions can change. Existing 0.1 installer/archive files are preserved; new versioned checksums identify the updated artifacts. No GitHub publishing, installation or system-wide AI service is performed as part of local packaging.
