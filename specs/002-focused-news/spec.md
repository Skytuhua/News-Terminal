# Focused free news terminal specification

Status: implemented with documented external gates, 2026-09-25.

## Contract

News Terminal is a local-first Windows reader organized around four primary sections:

- AI: artificial intelligence, model releases, AI research, AI industry and AI benchmark metadata.
- Technology: software, hardware, cybersecurity, space/engineering technology and general tech reporting.
- Stocks: markets, central-bank notices, earnings, investing and market-moving business coverage.
- Others: every retained story that does not confidently belong to AI, Technology or Stocks. Others is a real reading section, not a discard bin.

Existing topic tabs, custom topics, profiles, watchlists, saved/read/hidden state, backups, detached windows, briefing views and source settings remain compatible. Imported older records do not gain new rights or paid capabilities.

## Free-only runtime

The application must not run paid APIs, scraping proxies or hosted inference by default. Cloud AI provider settings may be preserved for backup compatibility, but summary execution is blocked for non-local providers. Local Ollama remains the only executable AI provider path and still requires source-level AI permission.

Source states are explicit:

- `free-keyless`: reviewed accountless feed or metadata endpoint.
- `approval-free`: user-supplied public feed after explicit publisher-permission attestation.
- `external-only`: public website link or search shortcut, not an automatic feed.

Public reachability, a source kind, a free API tier, or an old imported flag never proves storage, media or AI rights.

## Sources

Runtime catalog target: substantially more genuine free feeds than the original starter catalog, without inventing permissions. The catalog may include disabled reviewed candidates when permission, scope or business-use terms remain unresolved.

Current implementation count is recorded in `docs/focused-implementation-verification.md`.

## Media

Rows and reader views may expose image affordances only for stored item-scoped media references authorized by the Rust host. Nothing loads automatically. Loading media uses `media_load`, returns bounded data URLs, and is revoked by source permission changes/import boundaries. The three-publisher thumbnail gate requires real reviewed media policies and live native evidence; fixture images alone do not satisfy it.

## Models and Benchmarks

OpenRouter model metadata is fetched as metadata only. It must not create provider keys or run inference. Benchmark panels must remain separate by source/license/methodology. Arena and SWE-bench metrics must not be merged into a universal model ranking.

## Social

Official Mastodon/Lemmy/YouTube feed connections remain opt-in metadata feeds. Bluesky, Reddit and X are external-link/search shortcuts unless a future integration implements terms, moderation, delete/tombstone and backoff controls. Link-only social discovery must be labelled as not connected and not ingested.

## Acceptance

Implementation verification must map all 15 approved tasks to files, tests and evidence. A failed live endpoint, missing current pinned-media article, or missing social moderation control is a blocker or shortfall, not a pass.
