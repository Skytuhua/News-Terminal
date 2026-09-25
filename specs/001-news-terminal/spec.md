# News Terminal acceptance contract

Source of scope: `.hermes/plans/2026-09-23_012437-news-terminal.md`. Integration schema: `docs/IPC-CONTRACT.md`. See `.hermes/work-ownership.md` for concurrent ownership. All scenarios below must have actual evidence before overall completion.

| ID | User-visible acceptance scenario | Verification category |
|---|---|---|
| NT-01 | Read real RSS/Atom with attribution, timestamps and original links | parser/network + native smoke |
| NT-02 | One failed/rate-limited source does not remove cached or healthy-source content | service/domain integration |
| NT-03 | Save permitted excerpts and read after offline restart | DB restart + native smoke |
| NT-04 | Profiles isolate read/save/watchlists/preferences/alerts/layout | backend + UI |
| NT-05 | Topics, regions, languages, source and keyword filters change results | backend + UI |
| NT-06 | Search cached text using SQLite FTS with safe user queries | backend + UI |
| NT-07 | Recommendations show truthful deterministic reasons; reset preserves saves | backend + UI |
| NT-08 | Diversity control is explicit, with sparse-coverage limitations | ranking tests + UI |
| NT-09 | Create/reorder/close/select many tabs, retaining independent state | UI + persistence |
| NT-10 | Native detach/reattach/restart, missing monitor recovery and concurrent updates | geometry + real Windows |
| NT-11 | Conservative related coverage and split override; all originals remain accessible | grouping + UI |
| NT-12 | Revisions/timeline label ingestion versus publication times | DB + UI |
| NT-13 | Catch-up retains a stable previous-visit watermark | backend + restart |
| NT-14 | Watchlist alerts opt-in, deduplicated, rate limited and quiet-hour safe | time tests + native notification |
| NT-15 | Public discussion clearly separate; restricted services link-only | catalog + UI |
| NT-16 | AI only on request, per-provider consent, permitted content, credential-store keys | service + host + UI |
| NT-17 | Cancellation/failure/quota fallback never incurs an unapproved provider request | service fixtures + UI |
| NT-18 | AI provenance/content scope shown; original readable during failure | UI + native smoke |
| NT-19 | Backups/import validate transactionally; retention preserves saves | DB integration |
| NT-20 | Compact accessible dark keyboard UI, reduced motion, long multilingual text | screenshots + accessibility tests |
| NT-21 | Windows executable/installer launch, no required server, dependencies documented | build + native smoke |
| NT-22 | Source permission evidence and feature-level repository/license references retained | documentation audit |
| NT-23 | Release artifacts, hashes, measured runtime and exact test results recorded | release evidence |

## Conservative defaults
Global English starter profile, no inferred location, no alerts by default, no enabled cloud AI until user explicitly configures and consents. Summarization permission is separate from feed readability. No paid or unrestricted-free claims. Native alerts require the application process to run; no background daemon is installed silently.

## Security boundaries
All remote input is untrusted. Validate URLs, redirect destinations, DNS results, content size, XML, imported backup schema and every IPC operation. Never execute article scripts. No secrets in frontend persistence, logs, backups or repository. A preview server is not the production data plane.
