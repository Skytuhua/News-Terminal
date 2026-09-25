# News Terminal 0.3 daily-use guide

## Reading each day

- **Daily briefing** groups retrieved dated stories into sectors. **Your brief** remains the separate since-last-visit view. Neither claims complete world coverage.
- Headline pages display at most 100 rows. Pagination, keyboard navigation and full-cache search retain access to all returned stories, including older saved stories. No cached items are deleted to make the list faster.
- **J / K** move through the reading sequence. In Unread, moving back revisits a previous story without consuming the next unread story.
- **Close** dismisses the reader without hiding a story. **Hide** is a separate labeled action with a profile-bound Undo offer. Saved status is preserved when hiding/unhiding. Undo is a temporary recovery action, not a history browser.
- Empty views distinguish no saved items, filtered-out items, caught-up unread lists, unavailable sources and failed searches/refreshes. Use the contextual recovery action.
- Headline publication dates distinguish today, yesterday and older dates. Exact timestamps remain available; undated articles are not assigned invented dates.
- Pane widths are remembered per profile, window and tab in local UI preferences; narrow windows clamp rendered sizes without discarding the wider preferred layout.

## Sector source quotations

Open a sector's optional source-quotation section, inspect eligible/excluded counts and source notices, then explicitly request generation. At least two eligible stories are needed. The host selects only currently authorized inputs for the chosen profile/day/sector; it does not send every article automatically.

This feature is deliberately **AI-selected source quotations**, not a free-form combined factual narrative. Early real-model testing produced a wrong weather probability and altered forecast duration despite valid citation IDs. The safer workflow selects exact source passages and supplies host-owned citations. Inspect the original links and surrounding context: exact text matching does not establish truth, completeness, freshness, balance or factual entailment. Unsupported output is rejected instead of displayed. Ordinary headline outlines and permitted per-story summaries remain separate.

Source restrictions, local/cloud provider consent, cancellation and stale-input rejection remain in force. Sector outputs are transient, not saved into backups as authoritative news. No paid cloud service is enabled automatically.

## Performance evidence

Production-mode synthetic browser fixtures on the same Windows machine retain all stories while mounting 100 rows. Parent verification at 5,000 stories, three trials, measured cached reloads 93–104 ms, unread selection 112–114 ms, and search 230–248 ms (including the existing debounce). The original baseline showed multi-second interactions. See `daily-performance-baseline.md` and `evidence/daily-performance-parent.json` for environment, source fingerprints, exact values, limitations and reachability checks.

These figures are browser fixture timings, not real feed latency, cold Windows startup, SQLite throughput, AI speed or battery measurements. Connected visible live views continue local 1-second status checks; off/hidden views back off to 5 seconds and recheck on focus/visibility restoration. One upstream HN stream remains shared across windows.

## Distribution and limitations

The Windows installer remains unsigned and requires installed WebView2. Local Ollama/model files remain outside the installer. Existing 0.1 and 0.2 distributions are preserved. Source catalog/access limits, original media attribution, AI warnings, and the documented third-party notice/provenance qualifications still apply. See `v02-guide.md` for multimedia, live connections and screen controls.
