# v0.2 reviewed source contracts — conditional AI and exact-asset media

Review and live probes: **2026-09-23 UTC**. This is a scoped engineering rights review, not legal advice, a worldwide copyright opinion, an agency endorsement, or a blanket government-content license.

## Integration gate — do not ship the booleans alone

The catalog now contains **30 sources, 19 enabled**, computed by `python scripts/check-v02-sources.py`. Three government text feeds have conditional `aiAllowed:true`; only `nasa-technology` has conditional `mediaAllowed:true`. The new `rightsPolicy` object records the required item classifier, attribution, output label and exact media approvals. Existing fields and IDs are preserved; `mediaAllowed:false` is explicit everywhere else.

**These flags are permission ceilings, not complete authorization.** This assignment changes catalog/docs/checks only, not Rust, SQLite or UI. Before enabling these paths in a released executable, the parent must implement and test the classifiers below at ingestion **and again before AI/media requests**, using the shipped catalog as authority. If runtime cannot apply a required classifier, effective permission is **false**. An ignored `rightsPolicy` object plus a true boolean is a release blocker.

For these specifically named records, this document supersedes the historical “all bundled AI false”, “no Mastodon bundled” and “no remote images” defaults in `docs/source-policy.md`. All unrelated restrictions, including CNA commercial scope, disabled BBC/Guardian sources, Reddit/X external-link-only, no full-article fetching and provider consent, remain in force. `docs/v02-source-research.md` is the earlier research record, not the final catalog decision.

## Decisions and actual payload scope

| Source ID | Reading/storage | AI | Media | Catalog polling floor |
|---|---|---|---|---|
| `nhc-atlantic` | Supplied official Atlantic advisory/outlook excerpt, source/link/time | Conditional `nhc-origin-text-v1` | No | 15 min |
| `fed-press_monetary` | Board-supplied title/description only | Conditional `fed-origin-text-v1`; currently headline-only | No | 60 min |
| `fed-press_all` | Board-supplied title/description only | Same; mixed/joint/unrecognized items fail closed | No | 60 min |
| `nasa-technology` | Supplied description; never full `content:encoded` as article text | No | Only two approved byte-pinned assets, `nasa-exact-assets-v1` | Existing 120 min retained |
| `mastodon-official` | Official `@Mastodon@mastodon.social` public RSS description, sanitized; discussion | No | No | 15 min |
| `lemmy-world-technology` | Title, discussion permalink, source and time; deliberately empty excerpt | No | No | 15 min |
| `youtube-nasa` | NASA channel video title, watch link, source and time; deliberately empty excerpt | No | No; system-browser watch link | 30 min |

These floors are conservative app choices, not provider-published entitlements. Use the later of the configured floor, applicable Cache-Control/Expires freshness and Retry-After; retain conditional GET and independent error backoff. Manual refresh, restarts and multiple windows must not bypass the floor. Feed polling is not an incoming-event stream or a guarantee of current/live video status.

## Government-origin text: basis and exact item gates

NWS says its web information is public domain “unless specifically noted otherwise”, may be used for lawful purposes, but must not be claimed as one's own, imply NOAA/NWS endorsement, or be modified and presented as official government material.[2] The Federal Reserve Board permits copying/distributing its public-domain information unless otherwise indicated, requests Board source citation, excludes identified non-Board material, and separately protects seals/logos and forbids treating hyperlink permission as framing permission.[3] These are public-domain reuse bases for narrowly identified supplied text, **not an AI-specific license or official approval of this product**.

### Common prerequisites, before any model request

1. Resolve the immutable catalog ID **and exact reviewed feed URL** from the shipped catalog; reject changed/custom/imported endpoints carrying a trusted ID. Require source enabled, source AI permission, `rightsPolicy.version == 1`, a recognized rule, and an enabled/consented provider. Local Ollama is still an AI transformation; consent is not copyright permission and cloud fallback needs its own consent.
2. Evaluate the full supplied item title, description and explicit rights/credit metadata **before truncation/sanitization discards exclusion evidence**. Reject explicit third-party attribution, copyright/rights restrictions, “used with permission”, “all rights reserved”, “courtesy of” or ambiguous origin. Do not use a negative keyword scan alone as proof of authorship: the positive source/product rules below are required too. Unknown rule versions and unreviewed item patterns fail closed.
3. Retain only title, sanitized supplied description, source identifier, original URL and publication/issue time. No `content:encoded` fallback, page/attachment fetch, OCR, transcripts, quoted third-party article, logo or media in AI input. A feed excerpt is not a complete advisory or statement.
4. Persist a trusted classifier result keyed to source policy revision and the exact input revision; a restored item without this provenance must be revalidated or remain ineligible. Recheck authoritative policy before every retry, provider fallback, cache reuse, briefing summary and export. Imported `aiAllowed`, policy objects and item eligibility are untrusted.
5. Show the unchanged source excerpt separately from AI output, the original issue/publication time, original link, model identity and `rightsPolicy.outputLabel`. Attach required source attribution deterministically outside model-generated text. A prompt alone is not an attribution/safety enforcement mechanism. Do not market summaries as agency products, verified facts, emergency warnings or financial advice.

### `nhc-origin-text-v1`

Only `nhc-atlantic` at `https://www.nhc.noaa.gov/index-at.xml` qualifies. The current feed contains official text products **and a graphics item**; a feed-wide switch would be too broad.[9]

The initial positive classifier should accept only these HTTPS original links on the exact `www.nhc.noaa.gov` host (no credentials, non-default port or fragment):

- Exactly `/gtwo.php?basin=atlc`, with a supplied title identifying the Atlantic Tropical Weather Outlook.
- `/text/refresh/MIATCPAT[1-5]+shtml/NNNNNN.shtml` (public advisory), `/text/refresh/MIATCMAT[1-5]+shtml/NNNNNN.shtml` (forecast advisory), or `/text/refresh/MIATCDAT[1-5]+shtml/NNNNNN.shtml` (forecast discussion), with the matching supplied product title. Here `[1-5]` is one basin slot digit, `+` is a **literal plus**, and `NNNNNN` is six digits, not arbitrary path text.

In addition require a parseable `pubDate`, an issue-time line in the supplied description, and the case-insensitive positive marker `NWS National Hurricane Center` in that description. Reject rights exceptions and graphics/media-only products; reject alternate hosts, unrelated NHC pages and missing/ambiguous provenance. Summary items without the positive agency marker, wind-probability tables and other product families stay ineligible until specifically covered; do not silently broaden this classifier. Keep the original issue-time line unchanged in the source panel. Do not call a possibly truncated model input the complete warning.

Required fixed output label: **“News Terminal AI-generated analysis of a feed excerpt; not an official NOAA/NWS product. Check the original advisory; not an emergency-warning service.”** Identify the incorporated source text as NOAA/NWS National Hurricane Center public-domain NWS material; do not claim copyright in it. Preserve stale/issued-at indicators and original advisory access even when AI succeeds.[2]

### `fed-origin-text-v1`

Only the two exact bundled Federal Reserve press-feed endpoints qualify. At this review, all supplied descriptions in both feeds repeated their titles after entity/whitespace decoding; the feeds did **not** supply full FOMC statements, rate tables or meeting minutes.[10][11]

Initial positive classifier: require HTTPS `www.federalreserve.gov`, a path matching `/newsevents/pressreleases/(monetary|orders|enforcement|bcreg|other)YYYYMMDDx.htm` (eight date digits and one lower-case suffix letter), no query/fragment/credentials/non-default port, a parseable publication date, and decoded/whitespace-normalized description **equal to the title**. Require a title starting with `Federal Reserve`, `Minutes of the Board` or `Minutes of the Federal Open Market Committee`. Apply the common exclusions before normalization/truncation. Joint “Agencies …” announcements and unexpected patterns are reader-visible but AI-ineligible in this initial contract. If a later feed supplies expanded descriptions, reject AI until that expanded scope is reviewed rather than treating the new text as cleared.

This deliberately enables summaries/briefing organization of Board-authored **headline-level information**, not imaginary detail. Render **“Headline-only input — the feed does not contain the full statement.”** Preserve Board source citation and original date/link; generated prose is News Terminal's output, not a Board product or financial advice.[3]

## NASA: useful image/video without a whole-feed media license

NASA allows factual informational use of its content with acknowledgement and without endorsement, but explicitly excludes separately protected third-party material; NASA insignia, logos and identifiers have separate restrictions.[1] NASA's separate AI section has special generated-output attribution, disclosure and accuracy requirements, so **all NASA AI remains false**, including the YouTube discovery source.[1]

The first reviewed Technology item is `https://www.nasa.gov/?p=1045713`, with original article URL recorded in the allowlist. Its supplied HTML places an explicit `NASA` credit in the **individual caption containers** for both the ribbon-cutting image and the TDRS animation. Critically, the **same item also includes figures credited `MAXAR`**. Consequently neither NASA hostname, Technology-feed membership, item membership nor a single nearby `NASA` string clears all attachments.[8]

### `nasa-exact-assets-v1` — the shippable narrow classifier

`resources/sources.json` → `nasa-technology.rightsPolicy.mediaAllowlist` is authoritative and contains:

| Kind | Supplied direct URL | Bytes / checked identity |
|---|---|---|
| Image | `https://www.nasa.gov/wp-content/uploads/2026/09/ribbon-cutting-edited.jpg` | 3,468,255; SHA-256 `9edc61505384e8eff56548e2989b89586c3a568bdd2da136e33a6335ccd81dfa` |
| Video | `https://www.nasa.gov/wp-content/uploads/2024/10/tdrs-data-stream-apr1080.mp4` | 13,957,869; SHA-256 `8ed5f3d874c91213779b58d668bb3656f1d07088e27eada1ef396f6bcabada56` |

Both URLs occur in the item's explicit Media RSS metadata: the MP4 is `media:content`/`media:player`; the JPEG is its `media:thumbnail`. The supplied encoded body was inspected **for per-asset credits**, not promoted into stored article text. Each relevant container explicitly credits NASA; no third-party credit was attached to these two assets.[8]

The backend must:

1. Require the authoritative exact source ID and feed URL, enabled source, `mediaAllowed`, recognized version/rule, and a match to the approved `itemGuid` **and** `itemUrl`. Current parsers that discard feed GUID must preserve it or require independently verified provenance; do not trust imported item/source/media associations.
2. Require the candidate URL to be supplied in that exact item's feed metadata and to match an allowlist URL **exactly**. Query variants, changed paths, alternate hosts, third-party figures and additional thumbnails do not inherit approval. This intentionally chooses a finite reviewed exception, not a speculative generic rights detector.
3. Only on an explicit user load action, fetch through the bounded Rust network path with HTTPS/public-address/redirect validation, no cookies or credentials, no scripts, and a clear remote-request privacy notice. Reject redirects for these pinned assets unless separately reviewed. Enforce the expected byte count and absolute media bound; download completely to bounded temporary storage and compare SHA-256 **before exposing bytes to the webview/decoder**. Do not stream unverified changed content to the player. A mismatch revokes approval pending review.
4. Validate container/MIME; do not whitelist arbitrary `.mp4` files. This exact video response is `application/octet-stream`, but its byte-pinned content has MP4 `ftyp` and was independently parsed by `ffprobe` as **H.264, 1920×1080, duration 34.667567 seconds, one video stream and no audio stream**. The exact hash can justify its reviewed `video/mp4` type; generic binary media still fail closed. The JPEG was downloaded and visually inspected: people at a ribbon-cutting in front of tents and a radome, not an error response. This does not substitute for app playback/security testing.
5. Always display **NASA** credit and the original article link with the media; explain informational use/no endorsement. Keep the original contextual caption or a clearly separated factual description. No extracted NASA logo as app branding, advertising, implied endorsement by depicted people, AI processing, automatic playback, public redistribution or bundled/offline media export. Temporary cache must be removable; a source revocation clears its media cache and prior approvals.

An alternative future classifier can parse exact DOM/media-credit association in the supplied feed body, but must distinguish nested figure/container boundaries, reject MAXAR and all unknown/combined credits, and retain evidence. Merely testing `credit.contains("NASA")` is insufficient. The finite allowlist is the reviewed v0.2 implementation target; new assets require a new review rather than forever blocking all NASA media.

## Public social and video discovery: explicit limits

### Mastodon official account

`https://mastodon.social/@Mastodon.rss` returned 20 items; **all 20 lacked `<title>`** but supplied descriptions, permalinks and publication dates.[12] An ordinary parser may currently label them “Untitled”. Parent UI/parser should label them **“Mastodon post — @Mastodon”** or use a clearly identified short lead from the permitted description, without inventing a publisher headline. `storage:excerpt` is intentional: metadata-only would make this account mostly empty.

The rendered instance terms explicitly mention XML/API/RSS delivery and RSS readers/aggregators, while preserving content ownership. They explicitly apply to registered users and exclude nonregistered users; this is evidence of intended public RSS reading, **not a general third-party copyright sublicense**.[5] The same instance page identifies `@Mastodon` as its administrator. The catalog review covers only that operator's public account for a local personal reader, not an arbitrary instance, public timeline, comments, boosts archive or all federated authors. AI and media stay false. Attribute **Mastodon (@Mastodon@mastodon.social)** and each original permalink/time. No authentication or anonymous-stream bypass is needed or authorized.

### Lemmy.World Technology

The reviewed public community RSS supplies real titles, discussion links and timestamps, but its descriptions can contain quoted external publisher text and its enclosures can be `text/html`, not video.[13] The instance terms address copyright takedowns and prohibit disruptive use; they do not establish blanket reuse rights over user submissions or linked publishers.[4] Therefore this source is deliberately **title/discussion-link discovery only**, labelled discussion, with empty excerpt, no linked-page fetch, no comments, no media and no AI. Other communities/instances need independent review; no universal quota or license is assumed.

### NASA on YouTube

YouTube's official push-notification documentation publishes the channel Atom feed URL pattern.[6] The tested NASA channel returned 15 entries; the sample `media:content` was a legacy Flash player URL, **not downloadable MP4**, and the thumbnail was a separate YouTube-hosted resource.[14] Keep only video title, original watch link, channel attribution and time. Empty excerpt is expected, not a parser failure. Label **“Video discovery — opens YouTube”**, not “live”, “downloaded video” or “in-app playback”. No thumbnails, descriptions, unofficial transcripts, yt-dlp, stream resolution, player scripts or audiovisual caching. The official API policies expressly prohibit unauthorized audiovisual download/cache/offline playback; this catalog does not add an IFrame Player integration.[7]

For both social sources, retain minimally, provide delete controls, honor explicit removal requests across FTS/revisions/caches/exports, and do not infer that a saved flag creates perpetual rights. RSS disappearance is not proof of deletion; this catalog does not implement push-deletion monitoring. A general-purpose social archive, remote sync or redistribution needs a separate policy and implementation review.

## Real endpoint evidence and repeatable checks

`python scripts/check-v02-sources.py --probe --media` completed successfully at **2026-09-23T21:37:34Z**. It checks the entire catalog offline, then makes one bounded GET to each of the seven reviewed feeds and two pinned assets. All returned HTTP 200. It reports selected public response headers only, does not log cookies, retains no downloaded content and follows no story links.

| Feed | Parsed items | Observed cache hint | Detail |
|---|---:|---|---|
| NASA Technology | 10 | max-age=300, must-revalidate | ETag + Last-Modified |
| NHC Atlantic | 7 | max-age=300 | ETag + Last-Modified; text and graphics mixed |
| Fed Monetary | 15 | No Cache-Control observed | ETag + Last-Modified; UTF-8 BOM parsed from bytes |
| Fed Press All | 20 | No Cache-Control observed | ETag + Last-Modified; headline descriptions |
| Mastodon official | 20 | max-age=60, public | ETag; 20 missing titles |
| Lemmy.World Technology | 20 | public, max-age=60 | HTML enclosures are not media |
| YouTube NASA | 15 | public, max-age=900 | Atom, watch-link discovery |

The NASA image and video both matched the catalog SHA-256 and byte counts. The script validates configuration and reachability, **not legal clearance, per-item runtime enforcement, complete playback or a freshness SLA**. Network probes are opt-in; default checks are offline. Feed counts change legitimately and are not pinned in tests.

```sh
python tests/test_source_catalog.py
python scripts/check-v02-sources.py
python scripts/check-v02-sources.py --probe --media
```

The offline suite covers bundled social boundaries, conditional permissions/attribution, exact asset fields, duplicate IDs, forbidden permission/endpoint/storage/floor mutations, UTF-8 BOM/Atom parsing, unsafe/non-feed XML and explicit network CLI flags. Runtime tests still required: forbidden NHC graphics and unsigned summary items; unexpected Fed body/joint item; import-forged policies and source IDs; MAXAR in the same NASA item; wrong item/GUID/URL/hash; binary MIME mismatch; missing attribution; consent/fallback; policy revocation; and actual image/video rendering.

## SVS 4709 alternative: verified JSON, not an invented RSS feed

The parent supplied a passing production-loader/Chromium playback record in `docs/evidence/v02-media-live.json` for NASA SVS 4709, **The Moon's Rotation**, with image `orbit.0175_print.jpg` and video `orbit_720p30.mp4`. This review independently retrieved the official item, help policy and `https://svs.gsfc.nasa.gov/api/4709/` successfully. The item explicitly requests credit **NASA's Scientific Visualization Studio**; its recorded release date is 2017-10-06, not current news.[15][19] SVS help says its content is public domain unless otherwise noted, with a specific warning about licensed music; its current automated-access documentation describes free public **JSON APIs**.[16]

No current official SVS RSS/Atom endpoint was verified from its home/help/item links or NASA's current RSS directory. Do **not** insert the HTML item page or JSON API into the existing RSS parser, fabricate a feed, seed a static article, or silently crawl arbitrary SVS pages. A small explicit `nasa-svs-api` adapter could GET the documented `/api/4709/`, map its actual `id/title/url/release_date/update_date/main_image/media_groups[].items[].instance` fields, and keep the original 2017 release date. The real endpoint supplies both tested asset URLs. Require the same source/item/asset approval gates and preserve the official credit; `main_credits` also lists contractor employers, which is not by itself a substitute for the explicit SVS reuse policy. Do not extend this item's approval to music-bearing or otherwise excepted SVS media.[15][16][19]

The alternative is **not** added as a nonfunctional RSS catalog record. Its adapter and source transport are parent-owned; the shipped catalog's directly reachable media path remains the real NASA Technology RSS item described above. The Technology MP4's generic HTTP MIME still requires the exact-hash MIME handling described above, or it must remain blocked by the existing strict loader. The parent SVS evidence proves a useful alternative with genuine `video/mp4`, not that either item is already reachable through application ingestion.

## Database migration and release handoff

The original catalog was seeded only when creating the initial database. Editing JSON alone will not upgrade existing users. Parent must implement a versioned, idempotent catalog migration that:

- Adds the three new source IDs without duplicating current/custom records or resetting user profile ownership, enabled/disabled preferences, refresh state or user settings.
- Refreshes authoritative reviewed URL/storage/rights/notes/terms fields for known bundled records, while preserving **stricter user choices** and never converting a changed custom endpoint into a trusted source merely because its ID matches. Distinguish current effective consent from the catalog capability ceiling.
- Stores/retrieves `rightsPolicy` or provides an equivalent immutable backend lookup. Unknown/missing rules must be false; do not rely on the frontend to enforce notes.
- Reclassifies existing article revisions before activating new AI/media permission. Imported policies and prior cached AI outputs cannot grant authority. Invalidate eligibility, cached media and summary caches when policy/input revisions change.
- Tests both a new database and upgrade of a real v0.1 database. Reopening twice must be idempotent. Do not claim users received the new sources until migration is read back and checked.

### Exact backup-validation field handoff

The parent reported `backend::provider_configuration_never_persists_keys_and_catalog_is_real` failing with **“Cannot export restorable backup: Unknown or secret field in backup”** after this extension. Do not remove policy evidence to silence that failure. Add a bounded, typed **source** whitelist/validator for the new top-level `rightsPolicy` object (and `mediaAllowed` if the backup source schema does not yet include the already-added runtime flag):

```text
rightsPolicy.version: integer, exactly 1
rightsPolicy.requiresItemGate: boolean, must be true for these approvals
rightsPolicy.aiRule?: "nhc-origin-text-v1" | "fed-origin-text-v1"
rightsPolicy.mediaRule?: "nasa-exact-assets-v1"
rightsPolicy.attribution: bounded nonempty string
rightsPolicy.outputLabel?: bounded nonempty string
rightsPolicy.mediaAllowlist?: bounded array of objects with ONLY:
  itemGuid: HTTPS URL string
  itemUrl: HTTPS URL string
  url: HTTPS URL string
  kind: "image" | "video"
  mime: "image/jpeg" | "video/mp4"
  credit: bounded nonempty string
  evidenceUrl: HTTPS URL string
  sha256: 64 lowercase hexadecimal characters
  bytes: positive bounded integer
```

These fields contain no credentials. **Validation does not make imported permission authoritative**: allow legitimate backups to round-trip, then override/reconcile imported policies against the shipped catalog and revalidate article provenance before granting AI/media access. Suggested limits: 4 KiB for URLs and attribution/output text, at most 16 approvals, asset byte ceiling no greater than the production loader. Reject unknown nested keys, illegal rule combinations and malformed hashes; cap total import bytes with existing backup limits. `rightsPolicy` is optional on unreviewed/legacy records; missing means no conditional grant. Test round-trip with all three AI-policy records and the exact NASA allowlist, as well as forged imported rules/URLs/hashes.

No Rust/frontend/database files were changed by this catalog assignment. The necessary runtime and migration work is explicit, not claimed complete.

## Research capture limitation

The required `C:/Users/user/.Codex/rules/common/research-capture.md` could not be read (file not found), consistent with the earlier v0.2 research report. Mission Control Research-panel posting remains blocked; no command or destination was guessed. This document is the finished report to capture when that configured integration is restored.

## Sources

[1] https://www.nasa.gov/nasa-brand-center/images-and-media
[2] https://www.weather.gov/disclaimer
[3] https://www.federalreserve.gov/disclaimer.htm
[4] https://legal.lemmy.world/tos
[5] https://mastodon.social/terms-of-service
[6] https://developers.google.com/youtube/v3/guides/push_notifications
[7] https://developers.google.com/youtube/terms/developer-policies
[8] https://www.nasa.gov/technology/feed
[9] https://www.nhc.noaa.gov/index-at.xml
[10] https://www.federalreserve.gov/feeds/press_monetary.xml
[11] https://www.federalreserve.gov/feeds/press_all.xml
[12] https://mastodon.social/@Mastodon.rss
[13] https://lemmy.world/feeds/c/technology.xml?sort=New
[14] https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ
[15] https://svs.gsfc.nasa.gov/4709
[16] https://svs.gsfc.nasa.gov/help
[19] https://svs.gsfc.nasa.gov/api/4709
