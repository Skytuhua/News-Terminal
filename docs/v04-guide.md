# News Terminal 0.4 daily-use guide

## Recover hidden stories

Choose **Hidden stories** beneath Saved stories. This is the current reading profile's retained hidden collection, including items outside ordinary profile preferences and the normal headline snapshot. It is not a chronological hiding history: rows are ordered newest retrieved first.

- Search title and publisher locally; all search terms must match. Results display 100 rows per page. `/` or Ctrl+K focuses hidden search.
- **Restore** changes only Hidden. Saved and Read remain unchanged. Recovery does not open the reader, fetch media, or request AI.
- The application confirms a restore with a new collection read. If confirmation fails after the write was acknowledged, use **Reload hidden stories**; the interface does not pretend the write failed or invite duplicate writes.
- Normal profile filters still apply after restoration. Saved stories remain available through Saved.
- Recovery survives restart while the article remains in the local cache. It cannot resurrect deleted articles. Saving protects a story from ordinary cache cleanup; hiding alone does not.

The immediate Hide/Undo workflow remains available. Empty All/Saved lists now offer persistent recovery when their visible snapshot consists of hidden stories rather than falsely claiming the cache is empty.

## Understand source health

**Sources & health** reports enabled-source failures and provides source-specific details. Failed initial retrieval and partial refresh failures link to that existing panel. Disabled sources do not inflate its failure count.

Health rows distinguish recorded last attempt, last success and next eligibility. **Eligible after** is not a promise that a fetch will occur at that instant: both source interval and backoff apply. Inspecting health does not trigger feed requests, bypass rate limits or grant storage/media/AI permission. Older records without scheduling facts remain explicitly unknown.

## Performance changes

Workspace revision acquisition now reads only the validated profile's workspace, rather than loading and ranking articles. Revision compare-and-swap retries and authoritative post-write confirmation remain in place.

Single-source ranking consumes the already scored and sorted list directly while preserving exact ordering, score, reasons and diversity-relaxation behavior. Saved overflow is not truncated. Mixed-source ranking is unchanged.

See `v04-performance-baseline.md` and `v04-ranking.md` for isolated synthetic native-function measurements and limitations. Those timings are not real-feed latency, installed-app startup, GUI response time or interleaved A/B results.

## Safer backup replacement

Successful import invalidates pending reading-state and workspace actions in every surviving window. The host rejects actions from the previous database even when imported profile/article IDs and workspace revisions match. This prevents a delayed Restore or old tab edit from changing newly imported data. Failed imports return to the authoritative existing workspace rather than leaving an empty reader.

This protection uses an ephemeral host-owned replacement identity, not a persisted permission or backup field. Custom IPC callers must follow the required write-token contract in `IPC-CONTRACT.md`; missing or stale tokens are intentionally rejected.

## Compatibility and privacy

Existing workspaces and backups remain supported by this version. A backup containing the new `hidden` tab mode may be rejected by an older binary; do not assume backward compatibility with 0.3.

No chronological reading history, tracking service, new paid provider, automatic media fetching or extra dependencies are introduced. AI-selected quotations remain unverified source excerpts, not truth-certified synthesis. Existing permissions, source coverage and retention limits continue to apply.

## Verification status

Implementation test reports are in `v04-backend.md`, `v04-frontend.md` and `v04-ranking.md`. Independent review, actual Windows acceptance and final packaged-executable verification are separate release gates; consult their retained evidence before treating a local build as the completed release.
