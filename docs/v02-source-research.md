# v0.2 source research — public APIs, real payloads and rights gates

Reviewed/probed **2026-09-23 UTC**. Read-only research; no application code, source catalog, credentials or permissions changed. Results are point-in-time observations, not service guarantees or comprehensive legal clearance. Proposed intervals and bounds below are **News Terminal engineering defaults**, not provider-published quotas unless explicitly identified.

## Recommendation in one page

| Integration | Actually implementable keyless path | v0.2 recommendation / limitation |
|---|---|---|
| Hacker News | Firebase REST + Server-Sent Events (SSE) | First low-volume live adapter: official near-real-time API. Store story metadata only; no linked-page extraction or comment archive.[2][9] |
| Bluesky | Cached public AppView REST; **current Jetstream v2 XRPC WebSocket** | Opt-in selected-account reader; live transport genuinely delivered events in this probe. Ship only with moderation/report/block/delete controls. Not a blanket license for AI or redistributing user media.[11][25][56][47] |
| Mastodon | Public account RSS; public timeline REST only where instance allows | RSS is the reliable keyless starter. `mastodon.social` rejected anonymous public timeline access. Current streaming public timelines require a user token; not a keyless stream.[35][36][52] |
| Lemmy | Public community RSS and instance REST | User-chosen public communities, conservative polling, instance terms review. No universal instance quota or guaranteed API version.[37][38][44] |
| YouTube | Official channel Atom feed | Video discovery metadata and original watch links. Not downloadable video; not second-by-second live status. Optional official embed is a separate privacy/policy integration.[7][39][50][51] |
| NASA / NHC / Federal Reserve | Existing official feeds | Government-origin text can support a rights-reviewed briefing; media has separate credits/third-party exclusions. **Do not flip a whole-feed AI flag merely because the domain is `.gov`.**[16][17][18] |
| Reddit / X and other unreviewed social sites | System-browser links only | Keep existing `docs/source-policy.md` boundary: no hidden preview fetch, scrape, cookie replay, unofficial proxy, or paid fallback. Do not register ordinary web URLs as RSS sources. |

## 1. Hacker News: official live metadata contract

**Endpoints:**

- `GET https://hacker-news.firebaseio.com/v0/newstories.json`
- Same URL with `Accept: text/event-stream` for Firebase SSE.
- `GET https://hacker-news.firebaseio.com/v0/item/{id}.json` for story metadata.
- Optional `topstories.json` or `updates.json` when explicitly needed; avoid subscribing to the entire database root. The official API documents near-real-time data and currently says there is no rate limit; this is not an unlimited-use or latency SLA.[2]

**Observed:** list GET returned HTTP 200 JSON. SSE returned HTTP 200, `text/event-stream; charset=utf-8`, and an initial `event: put` snapshot at 1.141 seconds after connection. The bounded probe then ended on its 8-second idle read timeout; **no second change event was observed in that window**. Item `49822559` returned `id`, `type:"story"`, `by`, `time`, `title`, `url`, `score`, `descendants` without authentication.[33][57]

**Adapter contract (proposal):**

- One backend SSE connection shared across windows. `put` replaces at a relative JSON path; `patch` updates keys at a path. Keep-alives are transport liveness, not new stories. Handle `cancel` and `auth_revoked` without retry storms; accept documented 307 redirects only through validated destinations.[9]
- Diff stable IDs, hydrate only new/changed desired stories with bounded concurrency (e.g. 4), validate `type`, handle `null`, `deleted` and `dead`. Do not fetch `kids`, user profiles or arbitrary story URLs automatically.
- Initially retain only `id/title/url/by/time/score/type` plus `https://news.ycombinator.com/item?id={id}`. Label **discussion**, not independently verified reporting. HN's API/software availability does not grant rights over linked publisher articles or user text; keep AI off.
- Reconnect with jittered exponential backoff, merge a fresh list snapshot, and expose stale/disconnected status. HN list IDs and Firebase path updates are not a durable news cursor; do not invent `Last-Event-ID` recovery semantics.

## 2. Bluesky: use the current API generation, not stale Jetstream examples

### Keyless public REST

`GET https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=3` returned HTTP 200 with `feed`, `cursor`, post AT-URIs, author records, text, labels and embeds; observed `Cache-Control: public, max-age=30`.[34]

The official rate page requests use of cached `public.api.bsky.app` for public-web cases, says these direct endpoints do not support authentication, and describes generous limits without publishing a numeric AppView allowance. **Do not misapply the PDS's 3,000 requests / 5 minutes number to public AppView.** Respect 429, Retry-After and response headers; a suggested selected-account poll fallback is 60 seconds or slower.[25]

Hydrate selected stream records with:

`GET https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris={encoded-at-uri}`

Repeat `uris` for batching, **at most 25 AT-URIs** according to the official lexicon. Prefer hydrated post views for moderation labels, author identity and presentation-ready media instead of rendering raw Jetstream records unfiltered.[62]

### Current Jetstream v2: tested

```text
wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents?collections=app.bsky.feed.post&kinds=commit
WebSocket subprotocol: xrpc.v1.json
```

Official current documentation recommends v2 for new projects and says live-tail access requires no authentication. Narrow selected accounts with repeated `dids=did:...`; filters allow up to 100 collections and 10,000 DIDs. These are provider caps, not suitable default UI subscription counts.[11]

**Observed live result:** successful anonymous handshake and three JSON message envelopes, each with `$type` and `payload`. Payload fields were `$type`, `cid`, `collection`, `did`, `operation`, `record`, `rev`, `rkey`, `seq`, `time`. The three create events had `seq` values `26255885673`, `26255885727`, `26255885737`, with server timestamps `2026-09-23T21:06:29.156165Z`, `.168300Z`, `.170580Z`. This verifies arrival of real stream events, **not end-to-end publisher latency or a perpetual one-second guarantee**. Arbitrary user post bodies were not copied into this report.[45]

Current docs describe inclusive `cursor=N` recovery using the last processed sequence and at-least-once delivery. They also mention a `cursor` field on v2 events; **the observed frames did not contain that field**, but did contain `seq`. Preserve the actual adapter generation and observed schema; use documented sequence recovery, and test reconnect before shipping. The bounded probe did not test replay or deletion events. Historical Network Replay involves authenticated calls and is outside the keyless scope.[11][45]

**Legacy compatibility only:** `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post` is documented in the separate `jetstream-legacy` repository, with `wantedDids`, `time_us` and microsecond cursors. Do not mix those field/filter names with the tested v2 XRPC API. The current main Jetstream README explicitly links to legacy and the new docs.[3][10]

**Reader contract (proposal):** persist AT-URI `at://{did}/{collection}/{rkey}` and revision/cursor, upsert creates/updates, remove deleted records and attachments, process account/identity changes where relevant. A commit-only subscription does not cover account takedowns; either subscribe to the required account/identity events or revalidate via AppView before display. Bound queue/bytes, drop or backpressure safely, and use a small user-selected DID allowlist rather than an unrestricted global firehose.

**Permission/release gate:** the developer guidelines require illegal-content reporting, forbidden-content blocking, abusive-user blocking, deletion on request, response to reports, public monitored contact information, and reasonable security. These requirements are not met merely by showing a "public" badge. User ownership persists under the terms; no general AI, image redistribution or model-training permission was established. Keep `aiAllowed:false`, preserve author/permalink, suppress sensitive/unavailable items and purge local caches/indexes when removed.[56][47]

## 3. Mastodon: account RSS is keyless; public does not mean anonymous streaming

- Tested **`https://mastodon.social/@Mastodon.rss`**: HTTP 200, 20 RSS items, ETag, `Cache-Control:max-age=60`. Entries have GUID/link/date/HTML description; 5 `media:content` nodes appeared across the feed.[36]
- Tested **`https://mastodon.social/api/v1/timelines/public?local=true&limit=2`**: HTTP **422**, `{"error":"This method requires an authenticated user"}`. Do not silently replace this with scraping.[35]
- `https://mastodon.social/api/v2/instance` reported `configuration.timelines_access.live_feeds.local` and `.remote` as `disabled`; hashtag feeds were public. Discover capabilities on the selected instance rather than assuming all instances match.[60]
- Official timeline docs explain instance-dependent anonymous access. Where explicitly allowed, `GET https://{instance}/api/v1/timelines/public?local=true&limit=20` is a possible poll adapter, not a universally working URL.[5]
- Official streaming docs say public/local/hashtag streaming changed in **4.2.0** to require a **user token with `read:statuses`**. Therefore `/api/v1/streaming/public` is **not** the keyless v0.2 path. Do not seek anonymous mirrors to bypass it.[52]
- Documented default REST limits are 300 requests per 5 minutes per account and per IP; inspect `X-RateLimit-Limit`, `Remaining`, `Reset` and instance-specific responses. The rejected probe still returned `x-ratelimit-limit:300`.[14][35]

The instance's terms were read in the browser because initial HTML was only an app shell. They explicitly mention JSON/XML/API/RSS delivery and RSS aggregators/readers; content ownership remains with its owner. The terms apply to registered users and explicitly exclude nonregistered/federated users, so this is evidence of intended RSS delivery **not a blanket third-party copyright/AI license**. Use user-chosen account RSS with original attribution and short retention; review each additional instance independently.[61]

**Parser finding:** one RSS `media:content` had `type="video/mp4"` but `medium="image"`. Prefer a validated MIME/type decision over `medium` alone; animated video is not always labelled consistently. Preserve `description` as sanitized text and media credits/alt text separately; never render arbitrary remote HTML.[36]

## 4. Lemmy: community RSS first, version-aware optional REST

Tested without credentials:

- `https://lemmy.world/feeds/c/technology.xml?sort=New` — HTTP 200, 20 items, `Cache-Control:public,max-age=60`.[38]
- `https://lemmy.world/api/v3/post/list?type_=Local&sort=New&limit=2` — HTTP 200 JSON `posts` containing `post`, `creator`, `community` and counts; the sample included an external YouTube URL, `ap_id`, `published`, `removed`, `deleted`, `nsfw`, embed metadata. "Local" can refer to local community context; do not assume every creator/post origin is local.[37]

Official docs publish `/feeds/all.xml`, `/feeds/local.xml`, `/feeds/c/{community}.xml`, `/feeds/u/{user}.xml` patterns and note IP-based rate limiting. Private front-page/inbox/modlog feeds contain JWTs and are excluded. Instance API versions vary; the successful `v3` probe is not a claim all Lemmy instances use v3. No universal numeric read quota was verified.[44]

**Important media distinction:** this community feed included enclosures with `type="text/html; charset=utf-8"` and ordinary article URLs; those are **links, not playable media**. Separate `media:content medium="image"` nodes carried thumbnails. Never pass all enclosures to a video element or fetch article pages for metadata.[38]

Suggested initial polling: 5 minutes, conditional requests, source-specific backoff. Store title, canonical post/discussion URL, original external URL, origin `ap_id`, creator/community and publication time. No comments crawl, voting/posting, profile archive or AI. Keep user deletions/removals and NSFW controls effective. Lemmy.World's terms include bot posting restrictions and copyright rules; a reachable API or the Lemmy software license does not license user submissions or linked images. Broader redistribution/media retention remains a rights-review gate.[49]

## 5. YouTube: official feed is discovery, not a video download API

The official push-notification guide specifies:

`https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`

It documents channel updates and a publicly reachable callback/WebSub flow. A desktop app without such a callback should conservatively poll rather than promise push.[7]

**Real NASA channel probe:**

`https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ`

HTTP 200, **15 Atom entries**, `Cache-Control:public,max-age=900`. Sample entry `yt:video:v03RjDNwG1o`, title `Progress 96 Cargo Ship Docking`, published `2026-09-19T13:54:40+00:00`, updated `2026-09-21T19:36:14+00:00`, alternate watch link, `media:thumbnail` on `ytimg.com`. Its `media:content` was a legacy `youtube.com/v/...` URL with **`application/x-shockwave-flash`**, not MP4/HLS.[39]

**Recommendation:** known channel IDs, 15-minute-or-slower poll respecting cache headers, upsert by video ID with updated time, show watch links. Feed presence does not prove currently live status, playback availability or a complete channel archive. No yt-dlp, unofficial transcript extraction, stream URL resolution, raw video caching or background autoplay. The official API policies prohibit unauthorized audiovisual downloading/caching; official IFrame Player is the separate playback reference if embedding is later approved. Player integration, availability/errors and privacy controls must be tested in Tauri before claiming support.[50][51]

## 6. Official-feed payload evidence: text, images and actual video

The following counts were computed by XML parsing, not hand-estimated. "Media nodes" counts explicit enclosure/Media RSS content/player/thumbnail elements, **not unique assets**. `content:encoded` HTML images are recorded separately and are not permission to store full article HTML.

| Feed | HTTP / items | Observed payload and cache evidence |
|---|---|---|
| NASA releases `https://www.nasa.gov/news-release/feed/` | 200 / 10 | title/link/date/description plus `content:encoded`; 0 explicit media nodes; 16 `<img>` and 1 `<video>` tags across encoded bodies. ETag, Last-Modified, max-age 300.[40] |
| NASA technology `https://www.nasa.gov/technology/feed/` | 200 / 10 | 3 explicit media nodes on first item: direct MP4, player and JPEG thumbnail; 72 `<img>` and 1 `<video>` tags across encoded bodies. ETag, Last-Modified, max-age 300.[41] |
| NHC Atlantic `https://www.nhc.noaa.gov/index-at.xml` | 200 / 7 | Descriptions include real advisory text with HTML line breaks; titles, publication times and cyclone namespaced data. 0 explicit media nodes. ETag, Last-Modified, max-age 300.[42] |
| Federal Reserve monetary `https://www.federalreserve.gov/feeds/press_monetary.xml` | 200 / 15 | title/link/GUID/description/category/date; 0 media nodes. First description repeated the headline rather than supplying a full statement. ETag and Last-Modified.[43] |

**Encoding pitfall:** the Federal Reserve response body was UTF-8 with BOM, while Python requests guessed ISO-8859-1 from `text/xml`; parsing the guessed text failed. Parsing raw response bytes succeeded. Respect XML declaration/BOM rather than an HTTP client's fallback text guess.

**Actual NASA direct-media candidate from the first technology item:**

- Item: `NASA Celebrates Restoration of Guam Station Damaged by Typhoon Mawar`, GUID `https://www.nasa.gov/?p=1045713`; supplied body contained figure credits `NASA`.[41]
- `https://www.nasa.gov/wp-content/uploads/2024/10/tdrs-data-stream-apr1080.mp4` — HEAD 200, `Content-Length:13957869`, `Content-Type:application/octet-stream`, `Accept-Ranges:bytes`.[58]
- `https://www.nasa.gov/wp-content/uploads/2026/09/ribbon-cutting-edited.jpg` — HEAD 200, `Content-Length:3468255`, `Content-Type:image/jpeg`.[59]

These checks verify feed-provided URLs and asset response metadata only; **no image/video was downloaded, visually inspected or played**. The MP4's generic MIME type is a compatibility gate: do not silently infer safe playback from its extension. A future controlled media loader needs MIME/container validation, size/range limits and a graceful external-open fallback. The image credit applies to the supplied figure; do not assume it automatically clears every video/music/personality right.

## 7. US-government text and AI: candidate permissions, not a blanket switch

Current `docs/source-policy.md` intentionally keeps all bundled source AI permissions false. This research recommends a **scoped permission model and future review**, not changing that invariant now.

| Origin | Actual policy evidence | Safe direction for a future briefing |
|---|---|---|
| NASA | Media generally not subject to US copyright; factual informational use and acknowledgement allowed, but marked third-party material is excluded. The explicit AI section allows consideration of public information in AI applications with strict attribution/endorsement conditions.[16] | Candidate **verified NASA-origin supplied text only**, with third-party exclusions and separate factual source disclosure. AI output must be attributed to the AI product, not NASA; do not generate “according to NASA” wording or imply NASA validates the model. Label AI-generated output, state NASA is not responsible for its accuracy, and do not use NASA insignia with generated imagery/training. This needs source-aware output enforcement, not just a generic source citation badge. |
| NOAA/NWS, including NHC | NWS pages are public domain unless stated otherwise, usable for lawful purposes, but must not be claimed as one's own, imply endorsement, or be modified and presented as official government material. Third-party data/imagery has separate rights; timely Internet delivery is not guaranteed.[18] | Strong text candidate after origin/exclusion check. Preserve exact advisory issue time, link and authoritative original wording. Label any analysis “News Terminal generated analysis, not an official NOAA/NWS product.” Do not replace warnings or call this an emergency alert service. |
| Federal Reserve Board | Information is public domain unless otherwise indicated; copying/distribution permitted with Board source citation. Non-Board materials, seals/logos and framing have separate restrictions.[17] | Strong Board-authored text candidate with exclusions; original source credit and no endorsement. Existing monetary RSS mostly supplies headline-level text: briefing must not pretend it has read the complete statement or automatically fetch article pages. No claim of an explicit AI-specific endorsement/license—the policy is a public-domain reuse basis. |

No blanket AI permission for social posts, YouTube descriptions/transcripts, mixed-rights NASA attachments, stock photography, contractor material or third-party articles was established. User consent to a provider is an additional gate, not a replacement for rights. Local Ollama is still transformation, not a rights exemption.

## 8. Proposed minimal contracts (not yet implemented)

Extend authoritative backend records deliberately rather than overloading `Source.kind` or trusting imported flags:

```text
SourceAccess:
  transport = rss | atom | hn-sse | bluesky-rest | bluesky-jetstream-v2 | external-link
  endpoint, termsUrl, reviewedAt, enabled, pollFloorSeconds
  accessScope, textStorageScope, mediaPolicy, aiPolicy
  configuredActorsOrCommunities, lastSuccessAt, lastEventAt, retryAt

MediaRef:
  kind = image | video | audio | external-video
  originalUrl, thumbnailUrl?, mime?, width?, height?, alt?, credit?
  provenance = rss-enclosure | media-rss | supplied-html | api-view
  access = blocked | external-link | click-to-load | approved-direct
  rightsEvidenceUrl?, rightsStatus, byteLimit

LiveEvent:
  adapterVersion, sourceId, nativeId, nativeRevision?, nativeCursor?
  operation = upsert | delete | source-state
  publishedAt?, upstreamEventAt?, receivedAt, payloadScope

SectorBrief:
  profileId, localDate, timezone, windowStart, windowEnd, generatedAt
  sectors[{sectorId, articleIds, sourceIds, coverageGaps}]
  method = deterministic-headlines | permission-gated-ai
  inputRevisionIds, policyRevision, modelIdentity?, citations
```

**Behavioral acceptance requirements:**

- Backend owns one subscription per configured stream, shared across windows; pause/disable cancels it. Do not establish a fresh internet connection per panel.
- Publication time, upstream event time, local receipt and UI clock are distinct. Display `stream connected`, `polling every …`, `last item …`, `backoff` and `stale` honestly. Only SSE/WebSocket adapters can provide incoming-event-driven updates; **never one-second RSS polling**.
- Suggested feed floors: NASA/NHC 5–15 minutes subject to response headers; Fed 15 minutes or existing slower policy; Mastodon/Lemmy 5 minutes; YouTube 15 minutes. These are new implementation proposals, not permission to override stricter catalog/source rules. Apply jitter, conditional GET, 304, Retry-After and independent per-source backoff.
- Build daily sector digests deterministically from stored allowed fields first. Use an explicit timezone and half-open day interval, stable article IDs/revisions, per-source caps, coverage gaps, original links and a reproducible input list. Zero eligible articles is “no permitted coverage,” not invented prose.
- AI requires provider consent **and** current source policy **and** item/field-level rights, before even a local request. Never backfill missing text by fetching a publisher page or silently send metadata-only social content to AI.
- Default media blocked or external-link. Click-to-load changes privacy exposure but does not create a copyright license. Never autoplay remote video, render feed scripts/iframes, or infer that a link is a media file.
- Every URL/redirect/media request needs HTTPS/destination validation, SSRF/private-address protection, bounded bytes/decompression/time, no cookies, and an explicit origin policy. Media requests can disclose IP address; document this before enabling previews.
- Keep source/author/permalink and required credits. Treat deletion/removal, policy revocation, caches, FTS, revisions, saved items and exports consistently; “saved” does not create perpetual rights. RSS feed eviction is not conclusive deletion, so use short retention and explicit delete/revalidation mechanisms.
- Required tests before release: SSE path put/patch/null/cancel; stream reconnect and duplicate/delete/account events; 429/backoff; metadata-only/AI gates; XML BOM; Mastodon MIME conflict; Lemmy HTML enclosure; YouTube legacy Flash media; NASA generic binary MIME; all-window shared state and shutdown.

## Research limitations and capture

API reads and feed parsing were real; no production ingestion adapter, playback, reconnection suite, SLA, rights classifier or AI pipeline was implemented/tested. Fincept reference evidence is in `v02-references.md`. Context7 was consulted first for Firebase; its result missed SSE specifics, so official Firebase REST documentation was read directly. Broken old Lemmy/Bluesky doc routes were replaced with current primary sources, not treated as evidence.

Mission Control capture could not be performed: the required `C:/Users/user/.Codex/rules/common/research-capture.md` and referenced `C:/Users/user/Documents/Codex/mission-control` directory were absent. Do not claim a Research-panel post exists; capture these two reports when the configured rule/tool is restored.

## Sources

[2] https://raw.githubusercontent.com/HackerNews/API/master/README.md
[3] https://raw.githubusercontent.com/bluesky-social/jetstream/main/README.md
[5] https://docs.joinmastodon.org/methods/timelines
[7] https://developers.google.com/youtube/v3/guides/push_notifications
[9] https://firebase.google.com/docs/database/rest/retrieve-data
[10] https://raw.githubusercontent.com/bluesky-social/jetstream-legacy/main/README.md
[11] https://bsky.network/docs/jetstream
[14] https://docs.joinmastodon.org/api/rate-limits
[16] https://www.nasa.gov/nasa-brand-center/images-and-media
[17] https://www.federalreserve.gov/disclaimer.htm
[18] https://www.weather.gov/disclaimer
[25] https://docs.bsky.app/docs/rate-limits
[33] https://hacker-news.firebaseio.com/v0/newstories.json
[34] https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=3
[35] https://mastodon.social/api/v1/timelines/public?local=true&limit=2
[36] https://mastodon.social/@Mastodon.rss
[37] https://lemmy.world/api/v3/post/list?type_=Local&sort=New&limit=2
[38] https://lemmy.world/feeds/c/technology.xml?sort=New
[39] https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ
[40] https://www.nasa.gov/news-release/feed
[41] https://www.nasa.gov/technology/feed
[42] https://www.nhc.noaa.gov/index-at.xml
[43] https://www.federalreserve.gov/feeds/press_monetary.xml
[44] https://join-lemmy.org/docs/contributors/04-api.html
[45] wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents?collections=app.bsky.feed.post&kinds=commit
[47] https://bsky.social/about/support/tos
[49] https://legal.lemmy.world/tos
[50] https://developers.google.com/youtube/terms/developer-policies
[51] https://developers.google.com/youtube/iframe_api_reference
[52] https://docs.joinmastodon.org/methods/streaming
[56] https://docs.bsky.app/docs/developer-guidelines
[57] https://hacker-news.firebaseio.com/v0/item/49822559.json
[58] https://www.nasa.gov/wp-content/uploads/2024/10/tdrs-data-stream-apr1080.mp4
[59] https://www.nasa.gov/wp-content/uploads/2026/09/ribbon-cutting-edited.jpg
[60] https://mastodon.social/api/v2/instance
[61] https://mastodon.social/terms-of-service
[62] https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/feed/getPosts.json
