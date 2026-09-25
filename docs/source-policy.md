# Source, social-access and AI policy

Policy review: 2026-09-25 UTC. This file states intended controls and focused-build updates; release claims still require Rust-boundary and native verification, not only frontend visibility checks.

Focused build additions:

- Runtime sources are capped at 300 and each source records an access mode (`free-keyless`, `approval-free` or `external-only`) plus adapter metadata.
- Zero-paid mode blocks cloud AI provider execution in the Rust service layer. Imported Gemini/Groq settings are retained for compatibility but cannot run.
- OpenRouter model data, Arena rows and SWE-bench rows are metadata/benchmark panels, not inference providers and not global model rankings.
- Only `nasa-technology`, `mit-news-ai`, `esa-space-engineering` and `fed-feds-notes` currently have reviewed item-scoped media policies. These policies are exact-asset gates, not source-wide media rights. The Federal Reserve addition is a financial-market diagram, not a photograph or equity-specific report; see `docs/focus-fed-diagram-verification.md`.

## Independent permissions

1. `enabled` authorizes the configured personal reader to attempt a feed refresh. It is not a commercial redistribution right.
2. `storage:"excerpt"` permits only the supplied feed description/lead under the recorded source conditions. Do not extract article pages or prefer full `content:encoded`. Preserve attribution and required dispatch credits; sanitize markup without rewriting the publisher's meaning. `storage:"metadata"` means title, original URL, source and timestamps, **no description, article body, images, comments or AI payload**.
3. `aiAllowed` is a separate boolean and must default to **false** on old records, import, custom-source creation and unknown sources. Bundled true values are limited to the reviewed official/public-domain-style feeds `nhc-atlantic`, `fed-press_monetary` and `fed-press_all`. Neither `enabled`, user provider consent, a free API, a reachable feed nor public visibility overrides it.
4. Any future true value requires documented evidence covering the actual AI use and payload, item-level third-party exclusions where relevant, and a reviewed output/attribution policy. Do not treat a document permitting reading as permission to train, summarize or transform. Public-domain sources can be candidates, but a blanket source-level flag must not silently include third-party works.
5. Gate summaries before outbound requests, including local Ollama, retries and cloud fallback. Gate against authoritative current source data after import; imported `aiAllowed:true` is not trusted permission. Provider consent and permitted excerpt scope are additional requirements, not replacements.
6. Disabling a source stops refresh. Disabling AI stops new transformations. Policy changes may require deletion of cached material; a user's saved flag is not an unlimited copyright or retention grant.

The term "official notice" is only the IPC's content category for agency-origin material; it is not an endorsement or guarantee of accuracy. Discussion, reporting and opinion are not interchangeable. Mixed publisher feeds can contain analysis/opinion, so source-level `reporting` does not establish that every item is straight news.

## Source-specific guardrails

- CNA: personal/nonprofit **non-commercial** only under the reviewed RSS rules, credit `中央通訊社`, preserve its dispatch credit, no full article. For a work/commercial deployment, disable CNA until appropriate permission exists. No separate AI grant was verified.[3]
- BBC: stay disabled. Current metadata/feed/business terms are not equivalent to unrestricted extraction, caching or transformation permission.[2]
- Guardian: stay disabled. Section 3 includes AI/automated-use and database restrictions even though the RSS help page welcomes personal reading. Do not work around these with metadata-only indexing.[4][5]
- NASA: feed reading and factual source acknowledgement are distinct from attribution of generated text. Its AI guidelines say outputs should be attributed to the AI product, not NASA, and must not imply NASA validation or endorsement. The catalog deliberately leaves AI off rather than asserting a generic summary UI satisfies these requirements.[7]
- NWS: no modified content presented as an official government product, and preserve issue timestamps. The app is not an emergency-warning service.[9]
- Federal Reserve: its public-domain statement excludes identified outside material and its seal; no financial-advice or market-data completeness claim.[19] `fed-feds-notes` is Board staff analysis (IPC category `official notice`), not Board concurrence or an official recommendation. Only the reviewed August 26, 2026 repo-market introduction and Figure 1 are approved; unrelated notes retain metadata only. `fed-exact-diagram-v1` binds exact feed, item GUID/link, PNG URL, MIME, byte count and SHA-256. Figure 2/vendor data, seals/logos, regional Bank assets and arbitrary host images remain denied. The feed has no image enclosure: a compiled exact-item pin, not a scraper, supplies the reviewed asset. Preserve all of the diagram with no crop; retain Board/author credit and original link. AI remains false. The Board copy/distribute grant supports local cache/backup copies of the reviewed material with credit, but the app does not add an offline image-export feature. Rights chain: `docs/focus-stock-image-rights-followup.md`.
- MedlinePlus: mixed rights, including licensed encyclopedia/drug content; metadata-only and original-page links.[21]
- HN: no comments/body ingestion, no copying the linked article and no inference that an API/code licence covers user speech.[16]

## Reddit and X are external-link-only, not feeds

These are documentation-level link targets, deliberately **not** `Source` records: the IPC source kind has no `external-link` access mode, and inserting a normal web URL into an RSS refresh catalog would misrepresent support.

| Service | Allowed starter behavior | Explicitly not implemented/authorized |
|---|---|---|
| Reddit | Open `https://www.reddit.com/` or a user-chosen public community/search URL in the system browser, labelled discussion and external link | No background subreddit JSON/RSS scraping, cookie replay, unofficial mirrors, comment archive or summary |
| X | Open `https://x.com/` or a user-chosen public post/profile/search URL in the system browser | No guest-token scraping, Nitter substitute, authenticated capture, hidden preview fetch or paid API fallback |
| HN | Its official RSS is a separate enabled `discussion` source with `storage:metadata` and `aiAllowed:false` | No automatic linked-page or discussion-comment retrieval |

Opening an external link is not consent for the app to fetch, index, summarize, or retain platform content. Do not store search terms in telemetry. Bluesky is link-only in this build; future synced integrations require API/instance-specific terms, moderation labels, deletion/tombstone handling, rate-limit backoff and user controls, not assumed global social permission.

### Reddit: verified official access conditions

The current Responsible Builder Policy states: “Approval is required: You must request access and get explicit approval before accessing any Reddit data through our API”. It also requires explicit written approval for commercial data use, forbids bypassing limits and applies to developers including non-commercial apps.[14]

Data API Terms require documented access information (such as OAuth identity) and provide a conditional, revocable display licence; user content belongs to users, not Reddit. They restrict modifying user content other than display formatting and require handling removals. Thus a public subreddit or a working `.rss`/`.json` endpoint is not an approval workaround.[15]

The policy HTML returned HTTP 403 to the script, then was read successfully in a real browser on this review date. The access rule above is from that live official page, not a third-party pricing article. No API approval or credentials were requested or obtained; external links are the starter behavior.

### X: verified current pricing, not old subscription tiers

The official page describes **pay-per-usage, prepaid credits, no subscriptions**. At review it lists `Posts: Read` at **$0.005 per resource** and `User: Read` at **$0.010 per resource**; pay-per-use post reads are capped at **3 million per monthly billing cycle**. Prices are explicitly subject to change and the Developer Console is authoritative for an actual account.[12]

Do not market X as an unlimited/free production news source or hard-code superseded Basic/Pro tier assumptions. This app has no X API adapter, budget or paid fallback. A user deliberately opening an X link in their browser is separate from API ingestion.

### NewsAPI: free Developer plan is not a production backend

The official pricing FAQ says the Developer plan is for development/testing **in a development environment only**, not staging or production, **including internally**. It says use outside development requires an upgraded subscription.[13]

Therefore NewsAPI is not bundled or silently used as a fallback. The same page says full article content is not supplied. Its suggestion that a customer could scrape URLs is not publisher permission, so it does not override this app's no-full-text-extraction policy.[13]

## Refresh, retention and safety requirements

- HTTPS only for bundled feeds; validate every custom URL and redirect against SSRF/local-address rules. Bound request time, bytes, redirects, decompression and XML processing. No authentication/cookies or executable remote HTML.
- Respect ETag/Last-Modified, HTTP 304 and Retry-After. Back off per source, preserve healthy-source refreshes and never hide failures behind stale "live" badges. `refreshMinutes` is advisory; do not claim scheduling is implemented just because it is in JSON.
- Keep source/title/original URL and publication/first-seen times. Permit offline feed excerpts only as recorded. Remote media loading is disabled except explicit host-mediated exact-asset policies for reviewed item-scoped media. Saved text must be labelled feed excerpt, not full article.
- Retention, backups, search indexes, exports and revision timelines are copies too. Keep the minimum necessary, honor removals, provide delete controls, and re-review rights before remote sync or sharing an export. Imports cannot grant source rights.
- Heuristic related coverage is "likely related", never proof that multiple publishers independently confirmed an event. Ranking explanations should report actual topic/keyword/time/source rules rather than unsupported political balance or reliability scores.
- Weather/health/markets content is informational. Original timestamps and source links matter; AI must not hide safety caveats or imply agency endorsement.

## Release gate

Before release, test: disabled source skipped; metadata source description empty; `aiAllowed` missing/false rejected server-side; forged imported true cannot bypass policy; no fallback to a disallowed source/provider; no full-article request; source attribution retained; CNA commercial scope handled; stale weather visibly dated; source-specific retention/removal behavior. These are acceptance requirements, not reported passing tests from this documentation-only assignment.

## Sources

[2] https://www.bbc.co.uk/usingthebbc/terms-of-use
[3] https://www.cna.com.tw/about/rss.aspx
[4] https://www.theguardian.com/help/feeds
[5] https://www.theguardian.com/help/terms-of-service
[7] https://www.nasa.gov/nasa-brand-center/images-and-media
[9] https://www.weather.gov/disclaimer
[12] https://docs.x.com/x-api/getting-started/pricing
[13] https://newsapi.org/pricing
[14] https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
[15] https://redditinc.com/policies/data-api-terms
[16] https://raw.githubusercontent.com/HackerNews/API/master/README.md
[19] https://www.federalreserve.gov/disclaimer.htm
[21] https://medlineplus.gov/about/using/usingcontent
