# Source catalog and verification

Focused build update, 2026-09-25: the runtime catalog now contains 68 sources: 57 enabled, 11 disabled, 36 excerpt feeds, 32 metadata-only feeds, 68 `free-keyless` access entries and 68 feed adapters. Three item-scoped media policies are enabled (`nasa-technology`, `mit-news-ai`, `esa-space-engineering`), and three official/public-domain-style feeds retain AI permission (`nhc-atlantic`, `fed-press_monetary`, `fed-press_all`). See [focus-source-audit.md](focus-source-audit.md) and `resources/sources.json` for the current machine-counted state. The older review below is preserved as provenance for the original starter catalog.

Reviewed 2026-09-23 UTC. This is a bounded starter catalog for a **personal, non-commercial, local feed reader**, not a content licence, general legal clearance, commercial redistribution service, or universal news subscription. `resources/sources.json` is the runtime seed; this document keeps network observations separate from permission evidence.

## Machine-counted result

```json
{
  "total": 27,
  "enabled": 16,
  "disabled": 11,
  "aiAllowed": 0,
  "xmlGetPassed": 27,
  "enabledLanguages": [
    "en",
    "zh-TW"
  ],
  "catalogLanguages": [
    "de",
    "en",
    "fr",
    "zh-TW"
  ],
  "enabledTopics": [
    "business",
    "climate",
    "culture",
    "entertainment",
    "health",
    "markets",
    "politics",
    "science",
    "sports",
    "technology",
    "weather"
  ]
}
```

Verification executed: the embedded probe below was extracted from this document and run against the actual JSON. All 27 objects passed required-field/type/enum/default/unique-ID/unique-URL checks, and all 27 repeat GET/XML probes passed. The 27 pinned reference code/licence files across 11 repositories also returned HTTP 200. Citation/evidence validation passed for all four Markdown deliverables; the shared ledger reports informational unused-source warnings per individual document.

Every catalog URL received an actual HTTP GET and parsed as RSS/RDF XML with at least one item during this review. HTTP success **does not establish permission**, freshness, editorial quality or future uptime. The observations below were counted from saved script results, not inferred from URL names. No scraped full articles or live headlines are bundled into the app.

`status` remains `not refreshed` and `lastSuccess` remains `null`: a research probe is not a successful refresh in the user's application. `reviewedAt` is Unix seconds. `refreshMinutes` is a conservative application recommendation, not a promised publisher quota. `aiAllowed` is explicitly false for every bundled source; RSS reading permission is not AI permission.

## Permission decisions

- **中央通訊社 / CNA:** its official RSS page explicitly allows personal and nonprofit non-commercial use, requires attribution as `中央通訊社`, and requires retaining dispatch credits. It supplies headlines, leads and links and says unauthorized full-text reuse infringes its rights. This supports the narrow reader/excerpt mode only; commercial or workplace deployments must disable these entries unless separately licensed.[3]
- **NASA:** the official feed directory publishes the selected URLs. Its usage guidelines allow factual informational use without implying endorsement, require acknowledgement and exclude third-party copyrighted material. NASA now has specific AI attribution guidance; do not infer that a generic summary UI complies. These sources are official notices, not independent journalism.[6][7]
- **NOAA/NWS/NHC:** the NHC directory publishes its feeds and the NWS disclaimer describes government information as public domain unless otherwise noted, with attribution/no-endorsement/no-misrepresentation conditions. This is Atlantic-basin information only, not a local forecast or reliable emergency-warning channel.[20][9]
- **Federal Reserve:** official RSS directory plus public-domain notice, except specifically identified outside material; cite the Board and do not reuse seals. Monetary policy releases are not a market-price feed.[18][19]
- **MedlinePlus:** official RSS subscription instructions exist, but its content policy distinguishes public-domain material from licensed encyclopedia/drug/image material. Keep this source metadata/link-only and do not retrieve the linked full text.[22][21]
- **Hacker News:** its homepage advertises RSS, and the official API documentation offers public data. Keep only listing metadata/original links; API documentation is not a copyright licence for user comments or linked articles. Label this source `discussion`, never reporting.[80][16]
- **BBC, disabled:** historical RSS help describes personal non-commercial access, but current terms section 15 limits metadata extraction and business use. This application's SQLite indexing/retention and transformed presentation were not cleared. A working feed cannot resolve that uncertainty.[1][2]
- **The Guardian, disabled:** official RSS help allows personal non-commercial use, while current terms section 3 also limits database creation, automated extraction and AI uses. Preserve the feeds as reviewed candidates, not enabled defaults, until the intended cache/index use is resolved.[4][5]
- **France 24 French, disabled:** official RSS instructions invite subscription, but complete cache/index/redistribution conditions were not verified in this bounded review. Do not turn mere subscription discoverability into broader permission.[83]
- **DW German, disabled:** the official content-feed page requires unchanged content, attribution/direct link and no onward sharing. Its applicability to this reader's persistent index remains unresolved. The older RSS-directory URL returned 404; the actual RDF feed did work.[78]

## Feed GET evidence and runtime defaults

Checked 2026-09-23 19:20 UTC using Python `urllib.request`, a descriptive user agent, 35-second timeout, bounded 4 MB reads and `xml.etree.ElementTree`. Counts reflect that single response, not database counts. Feed URLs link directly to the tested endpoint. Hashes identify the observed response bytes and will change as publishers update feeds.

| ID / endpoint | Topics | Region / language | Default / storage | GET / XML items | Response SHA-256 prefix |
|---|---|---|---|---|---|
| [cna-politics](https://feeds.feedburner.com/rsscna/politics) | politics | Taiwan / zh-TW | on / excerpt | 200 / 20 | `843a938c489ceac4` |
| [cna-intworld](https://feeds.feedburner.com/rsscna/intworld) | politics | World / zh-TW | on / excerpt | 200 / 20 | `94889e89843d6a32` |
| [cna-finance](https://feeds.feedburner.com/rsscna/finance) | business, markets | Taiwan / zh-TW | on / excerpt | 200 / 20 | `9b13d96a9bf4cde1` |
| [cna-technology](https://feeds.feedburner.com/rsscna/technology) | technology | Taiwan / zh-TW | on / excerpt | 200 / 20 | `8f0f899a99a0a770` |
| [cna-lifehealth](https://feeds.feedburner.com/rsscna/lifehealth) | health | Taiwan / zh-TW | on / excerpt | 200 / 20 | `eff4098b04dabce3` |
| [cna-culture](https://feeds.feedburner.com/rsscna/culture) | culture | Taiwan / zh-TW | on / excerpt | 200 / 20 | `a69d0359a98514f7` |
| [cna-sport](https://feeds.feedburner.com/rsscna/sport) | sports | Taiwan / zh-TW | on / excerpt | 200 / 20 | `2eb58c7903cd884e` |
| [cna-stars](https://feeds.feedburner.com/rsscna/stars) | entertainment | Taiwan / zh-TW | on / excerpt | 200 / 20 | `9712895e870d6d94` |
| [bbc-world](https://feeds.bbci.co.uk/news/world/rss.xml) | politics | World / en | off / metadata | 200 / 28 | `80cea090c279c17c` |
| [guardian-world](https://www.theguardian.com/world/rss) | politics | World / en | off / metadata | 200 / 45 | `498e81ef5e7d2100` |
| [guardian-politics](https://www.theguardian.com/politics/rss) | politics | UK / en | off / metadata | 200 / 21 | `4a1a9b95a89b4152` |
| [guardian-business](https://www.theguardian.com/business/rss) | business, markets | World / en | off / metadata | 200 / 20 | `adec8ef5152765d1` |
| [guardian-technology](https://www.theguardian.com/technology/rss) | technology | World / en | off / metadata | 200 / 36 | `7376689d8ea024ad` |
| [guardian-science](https://www.theguardian.com/science/rss) | science, health | World / en | off / metadata | 200 / 26 | `c8c66b3ba8070d4a` |
| [guardian-climate-crisis](https://www.theguardian.com/environment/climate-crisis/rss) | climate | World / en | off / metadata | 200 / 13 | `8aa566eea0165085` |
| [guardian-sport](https://www.theguardian.com/sport/rss) | sports | World / en | off / metadata | 200 / 22 | `8c077e2325502c08` |
| [guardian-culture](https://www.theguardian.com/culture/rss) | culture, entertainment | World / en | off / metadata | 200 / 26 | `5d6e27a939ebaa0d` |
| [nasa-releases](https://www.nasa.gov/news-release/feed/) | science | US / en | on / excerpt | 200 / 10 | `46a2c851b7947a35` |
| [nasa-technology](https://www.nasa.gov/technology/feed/) | technology, science | US / en | on / excerpt | 200 / 10 | `68968d5431e4c8c9` |
| [nasa-giss](https://www.nasa.gov/centers-and-facilities/giss/feed/) | climate, science | US / en | on / excerpt | 200 / 10 | `81308dd2a645ba16` |
| [nhc-atlantic](https://www.nhc.noaa.gov/index-at.xml) | weather | US / en | on / excerpt | 200 / 2 | `053291ea4b1530e7` |
| [fed-press_monetary](https://www.federalreserve.gov/feeds/press_monetary.xml) | markets, business | US / en | on / excerpt | 200 / 15 | `6ef9f8ee2019c031` |
| [fed-press_all](https://www.federalreserve.gov/feeds/press_all.xml) | business, markets, politics | US / en | on / excerpt | 200 / 20 | `583620ab65c03fb3` |
| [medlineplus-new](https://medlineplus.gov/feeds/whatsnew.xml) | health | US / en | on / metadata | 200 / 54 | `bbe2884ad68ef351` |
| [hacker-news](https://news.ycombinator.com/rss) | technology, business, science | World / en | on / metadata | 200 / 30 | `eb1138752f2250ec` |
| [france24-fr](https://www.france24.com/fr/rss) | politics, business, culture | World / fr | off / metadata | 200 / 24 | `12f2af04a8f28588` |
| [dw-de](https://rss.dw.com/rdf/rss-de-all) | politics, business, culture | World / de | off / metadata | 200 / 88 | `3376c29737b6dc14` |

The Guardian's business/technology/sport/culture endpoints redirected to `/us/.../rss` during this probe. Keep the requested URL in the catalog and validate redirects at runtime; do not infer that the user's region is US from this server-selected edition.

## Coverage boundaries

- Enabled feeds cover the requested politics, business, markets, technology, science, health, weather, climate, sports, entertainment and culture tags **collectively**, not each language or location equally. This does not promise that every refresh contains each topic.
- Enabled general reporting is currently Traditional Chinese CNA. English enabled sources are narrower official scientific/financial/health/weather notices plus HN discussion. **An English-only profile will not receive broad enabled independent politics/sports/entertainment reporting.** BBC and Guardian are candidates, not hidden fallback sources.
- `region` is a coarse topical/edition label, not publisher nationality, jurisdiction, user location or proof of local reporting. CNA's international feed uses World; Taiwan feeds can contain international stories. NASA climate science is global in subject even though the source is US.
- Enabled language coverage is English and Traditional Chinese; French and German candidates remain disabled. There is no automatic translation or guaranteed local coverage in Africa, Latin America, South Asia, Oceania, Japan, mainland China, or arbitrary cities/postcodes. Do not market this starter set as globally representative or politically balanced.
- NHC only provides Atlantic-basin tropical-weather products. No universal weather service, live securities quotes, broad sports scores or medical advice is provided.
- `custom` is an extensibility mode, not an invented publisher feed. Use the IPC `source_add` flow for a user-permitted RSS/Atom endpoint with explicit topics, language, region, rights evidence and `aiAllowed:false`; custom source permission must be reviewed independently. Topic tags and custom watchlist keywords do not manufacture absent local reporting.
- All selected feeds returned RSS/RDF in this run. No live Atom source was selected; this review does not verify the application's Atom parser or refresh code.

## Reproduce a probe (not a permission check)

Run from the repository root. This validates the seed contract and tests all URLs, including disabled candidates, **only for this explicit review**. Normal runtime refresh must skip disabled sources. The XML parser in this small trusted-endpoint audit is not the application's untrusted-feed security implementation.

```python
import concurrent.futures, json, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path
catalog = json.loads(Path("resources/sources.json").read_text(encoding="utf-8"))
required = {"id", "name", "url", "homepage", "kind", "topics", "region", "language",
            "enabled", "status", "lastSuccess", "termsUrl", "storage", "aiAllowed"}
assert len({s["id"] for s in catalog}) == len(catalog)
assert len({s["url"] for s in catalog}) == len(catalog)
for s in catalog:
    assert required <= s.keys()
    assert s["kind"] in {"reporting", "discussion", "official notice", "opinion"}
    assert s["storage"] in {"excerpt", "metadata"}
    assert type(s["enabled"]) is bool and type(s["aiAllowed"]) is bool
    assert s["status"] == "not refreshed" and s["lastSuccess"] is None
    assert isinstance(s["topics"], list) and all(isinstance(t, str) for t in s["topics"])
def probe(s):
    try:
        req = urllib.request.Request(s["url"], headers={
            "User-Agent": "NewsTerminal-source-review/0.1 (RSS compatibility review)"})
        with urllib.request.urlopen(req, timeout=35) as r:
            data = r.read(4_000_001)
            assert len(data) <= 4_000_000
            status, final = r.status, r.url
        root = ET.fromstring(data)
        assert root.tag.split("}")[-1] in {"rss", "feed", "RDF"}
        items = sum(e.tag.split("}")[-1] in {"item", "entry"} for e in root.iter())
        return {"id": s["id"], "status": status, "items": items, "finalUrl": final}
    except Exception as e:
        return {"id": s["id"], "error": str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(probe, catalog))
print(json.dumps({"count": len(catalog), "enabled": sum(s["enabled"] for s in catalog),
                  "aiAllowed": sum(s["aiAllowed"] for s in catalog),
                  "results": results}, ensure_ascii=False, indent=2))
assert len(results) == len(catalog)
assert all(r.get("status") == 200 and r.get("items", 0) > 0 for r in results)
```

## Audit limitations and capture

This is factual permission evidence and conservative product policy, not legal advice or legal clearance. Review publisher terms again before distribution, business use, enabling a disabled source, expanding stored content or enabling AI. No credentials, API purchases, subscriptions or cloud AI requests were used.

Raw response hashes, extracted policy pages, probe scripts/results and the citation ledger were captured in the local scratch directory `C:/Users/user/AppData/Local/Temp/news-terminal-research/`; it is not a durable shipped archive. The tables and policy excerpts in these documents preserve the decision evidence. Mission Control research capture could not be performed: `C:/Users/user/.Codex/rules/common/research-capture.md` is missing, so no destination or posting command was guessed. The configured Graphify index and local graph report were also absent. Neither issue was treated as permission to invent evidence.

## Sources

[1] https://www.bbc.co.uk/news/help-11144227
[2] https://www.bbc.co.uk/usingthebbc/terms-of-use
[3] https://www.cna.com.tw/about/rss.aspx
[4] https://www.theguardian.com/help/feeds
[5] https://www.theguardian.com/help/terms-of-service
[6] https://www.nasa.gov/rss-feeds
[7] https://www.nasa.gov/nasa-brand-center/images-and-media
[9] https://www.weather.gov/disclaimer
[16] https://raw.githubusercontent.com/HackerNews/API/master/README.md
[18] https://www.federalreserve.gov/feeds/feeds.htm
[19] https://www.federalreserve.gov/disclaimer.htm
[20] https://www.nhc.noaa.gov/aboutrss.shtml
[21] https://medlineplus.gov/about/using/usingcontent
[22] https://medlineplus.gov/rss.html
[78] https://corporate.dw.com/en/dw-world-content-for-your-website/a-669303
[80] https://news.ycombinator.com
[83] https://www.france24.com/fr/flux-rss
