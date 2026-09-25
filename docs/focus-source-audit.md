# Focused source audit

Review date: 2026-09-25.

This is an implementation-time audit of `resources/sources.json` for the focused free-news build. It supplements `docs/sources.md`; it does not replace publisher terms or legal review.

## Machine-counted catalog

```json
{
  "total": 69,
  "enabled": 58,
  "disabled": 11,
  "aiAllowed": 3,
  "mediaAllowed": 4,
  "imagesAvailable": 4,
  "storageExcerpt": 37,
  "storageMetadata": 32,
  "accessModes": { "free-keyless": 69 },
  "adapters": { "feed": 69 },
  "enabledLanguages": ["en", "zh-TW"],
  "catalogLanguages": ["de", "en", "fr", "zh-TW"]
}
```

Enabled topics now include `ai`, `technology`, `markets`, `business`, `research`, `science`, `space`, `politics`, `health`, `weather`, `climate`, `sports`, `entertainment` and `culture`. Feed topic tags are input signals; runtime article sections are assigned by `src-tauri/src/topics.rs`.

## Permission stance

- All sources are accountless/free at runtime. No paid scraping proxy, paid news API, hosted inference endpoint or billing-dependent feed adapter is used.
- `aiAllowed:true` appears only on `nhc-atlantic`, `fed-press_monetary` and `fed-press_all`, preserving the existing strict official/public-domain-style policy. It does not enable cloud inference because zero-paid mode blocks non-Ollama providers server-side.
- `mediaAllowed:true` and `imagesAvailable:true` appear only on reviewed item-scoped policies: `nasa-technology`, `mit-news-ai`, `esa-space-engineering` and `fed-feds-notes`.
- The media rows are still exact-item and exact-asset gated. They are not source-wide image permission, and the native app must not invent thumbnails when current feeds do not contain those pinned items.
- BBC, Guardian, France 24 and DW remain disabled metadata candidates because feed reachability is not sufficient permission for this local cache/index workflow.
- Reddit, X and Bluesky remain external-link/search shortcuts, not feed sources. Mastodon, Lemmy and YouTube support only user-added official metadata feeds after terms acknowledgement.

## Focus additions

The feed expansion added accountless AI/technology/markets sources from official labs, model/tool vendors, independent technical publications, market/central-bank feeds and selected publisher feeds. The catalog also includes OpenRouter RSS as a news source; OpenRouter model JSON is handled separately by the metadata-only `model_catalog` IPC path.

## Shortfalls

- Live reachability and publisher terms can change after this audit. `python scripts/check-v02-sources.py --probe` must be run as separate live evidence before release claims.
- The plan requested native evidence for three unrelated focused-publisher thumbnails. The catalog has four reviewed media policies (the Fed addition is a financial-market diagram, not a photo), but acceptance still depends on current live feeds containing those exact pinned items and the native smoke showing the images.
- Artificial Analysis remains link-only/not implemented because no free authorized accountless data contract was established.
