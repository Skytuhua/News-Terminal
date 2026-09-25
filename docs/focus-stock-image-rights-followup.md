# Stocks image-rights follow-up

Checked: 2026-09-25 UTC. Scope: bounded, read-only publisher research; no application edits or builds. This is documented reuse evidence, not legal advice.

## Outcome

**A defensible, genuinely free financial-market article + image candidate was found, but the image is a diagram, not a photograph.** The publisher is the **Board of Governors of the Federal Reserve System**, publishing *FEDS Notes*. The exact item is currently present in its live RSS feed, and the article and its Figure 1 PNG all returned HTTP 200 without an account, API key, or payment.[18][20][22]

This can satisfy an **article-image** interpretation if a financial-market analysis publisher and non-photographic figure are acceptable. It does **not** establish a solution to a literal Stocks-*photo* requirement, daily equities-news coverage, or the complete application's release gate. Do not silently promote it to those stronger claims. The item concerns Treasury/repo funding markets rather than individual company stocks.[20][23]

## Exact candidate

| Field | Verified value |
|---|---|
| Publisher | Board of Governors of the Federal Reserve System; not a regional Federal Reserve Bank, and not another MIT or ESA feed alias |
| RSS | `https://www.federalreserve.gov/feeds/feds_notes.xml` |
| Feed title | `FRB: FEDS Notes` |
| Feed item title | `FEDS Note: Repo Markets and the Fed’s Balance Sheet: Implications for Monetary Policy Implementation` |
| Article title | `Repo Markets and the Fed’s Balance Sheet: Implications for Monetary Policy Implementation` |
| Item publication date | `Wed, 26 Aug 2026 18:30:00 GMT` |
| Authors | Sriya Anbil, Alyssa Anderson, Lucy Cordes, and Romina Ruprecht |
| Article / GUID | `https://www.federalreserve.gov/econres/notes/feds-notes/repo-markets-and-the-feds-balance-sheet-implications-for-monetary-policy-implementation-20260826.html` |
| Exact asset | `https://www.federalreserve.gov/econres/notes/feds-notes/fig1-4069.png` |
| Caption | `Figure 1. Effect of Balance Sheet Decline on Repo Markets` |
| Original HTML alt | `Figure 1. Effect of Balance Sheet Decline on Repo Markets. See accessible link for data.` |

The feed supplies the exact title, link/GUID, date, author links and introductory excerpt; its inspected item contains no image enclosure or media image. The PNG is discovered on the linked article, not supplied by the RSS item.[18][20]

### HTTP and actual-byte verification

These are observations from direct HTTP requests during this task, not publisher promises:

- RSS: HTTP 200; `Content-Type: text/xml`; 20,724 response-body bytes; XML parsed as RSS; 15 items. The candidate appeared in that response. Latest dated item in the observed feed was September 22, 2026.
- Article: HTTP 200; `Content-Type: text/html`; 126,720 response-body bytes.
- Exact PNG: HTTP 200; `Content-Type: image/png`; **98,752 bytes**; **1221 × 471 pixels** verified from PNG IHDR; signature `89504e470d0a1a0a`.
- SHA-256 of downloaded PNG: `56373565c12becc07967821a416196ef2f61b2237dd7444a9840cd04128369aa`.
- Visual inspection: colored, four-part T-account diagram for Federal Reserve, Dealers, MMF and Banks. **Not a photograph.** No visible photo-agency credit, logo, seal, copyright notice or watermark. PNG chunk inspection found no `tEXt`, `iTXt` or `zTXt` metadata credit. Absence of a watermark is not independently a license.

## Rights chain: exact text and narrow applicability

### Explicit Board grant

The live Board disclaimer says:

> “Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information.”[17]

Its immediately following exception is important:

> “For any photo, graphic, or other material that is identified as being associated with a non-Board (such as materials with a copyright or trademark) permission to copy and distribute such photo, graphic, or material must be obtained from the non-Board source.”[17]

**Application to the requested operations:** the express public-domain/copy/distribute grant supports personal noncommercial display and local copies of this Board-authored title/date/URL/byline, its original introductory excerpt, and Figure 1, including retaining those copies in a local backup. The policy does not enumerate the technical words “cache” or “backup”; this is an application of its unrestricted copying grant, not a fabricated cache-specific clause. No archive-retention deadline is stated in that grant. Retain source/credit and the rights evidence with cached records.[17][18][20]

### Why this figure, not everything on the host

- The article itself describes Figure 1 as “A simplified example of this mechanism ... shown in stylized T-accounts in Figure 1.” It is embedded as `fig1-4069.png` in that figure's panel, rather than selected from generic site chrome.[20]
- The accessible Figure 1 description states: “This diagram illustrates how Treasury securities move from the Fed's balance sheet to dealers, funded by repo agreements with MMFs, while bank reserves and deposits decline.” It identifies a conceptual illustration, not a third-party photograph or an empirical vendor-data chart.[23]
- The inspected Figure 1 panel, caption, adjacent explanatory text and accessible description contain **no non-Board source credit or separate rights reservation**. The article labels FEDS Notes as articles in which Board staff present their own analysis; lead author Anbil's Board profile lists Board employment from 2015 to present.[20][23][24]
- **Figure 2 is not approved here.** Unlike Figure 1, its source line names the Federal Reserve Bank of New York, iMoneyNet and Money Fund Analyzer-Gold alongside the Board and Treasury. Table 1 has similar third-party sources. No reuse permission for those vendor-associated materials was established.[20][23]

**Assessment:** this is a defensible item-level application of an explicit publisher default grant plus inspection for the grant's exceptions. It is **not** a bespoke signed license for Figure 1 or a claim that every `.gov` asset is public domain. If an acceptance rule requires an affirmative per-file license label rather than this evidence chain, that stricter requirement remains unresolved.

### Credit and restrictions to preserve

Suggested display credit:

> Figure 1, “Effect of Balance Sheet Decline on Repo Markets” — Board of Governors of the Federal Reserve System; Sriya Anbil, Alyssa Anderson, Lucy Cordes and Romina Ruprecht, FEDS Notes, August 26, 2026. Public domain under Board website policy; source linked.

This combines the Board's requested source credit with the article authors; **no individual graphic designer or photographer is named for this asset**. Preserve the article title and source link, and link the rights policy.[17][20]

Exclusions and implementation boundaries:

1. Approve only this article's Board-original metadata/introduction and **Figure 1 exact URL**. Re-evaluate future articles and every different image; do not make a host-wide image allowlist.
2. Do not reuse Board seals/logos/official insignia: the policy requires written permission. Do not suggest Federal Reserve endorsement.[17]
3. Do not iframe/frame the Board website: the policy expressly distinguishes permitted hyperlinks from unauthorized framing. Local display of this licensed asset with attribution is a different operation.[17]
4. Preserve that FEDS Notes represent the authors' analysis, not Board concurrence; do not present this as an official investment recommendation.[18][20]
5. Do not extend this grant to regional Federal Reserve Bank sites, linked research papers, vendor data, cited third-party text, or external photography.[17][20]
6. If used in a card, avoid a crop that removes parts of the diagram or changes its meaning. A card image is possible, but this wide, text-heavy schematic may be less suitable than photography at small sizes.

## Bounded alternatives and honest limits

- **SEC / Investor.gov:** direct requests returned HTTP 403. Search discovery surfaced SEC's Webmaster FAQ warning that stock-art photos are among content not freely reusable, but the live FAQ could not be verified in this session. No SEC or Investor.gov photo was approved. An agency host or free RSS alone is insufficient evidence.
- **Wikinews:** search discovery surfaced a report of closure/read-only transition; direct article retrieval returned HTTP 403. The search result was not treated as independently verified live-page evidence. No current licensed financial photo/feed-item pair was established.
- **Other Board notes examined:** the September 4 monetary-aggregates article had no article-body image; the August 11 private-credit article's inspected chart sources included PitchBook. Neither supplied a cleaner photograph alternative.
- Guardian and BMW were not pursued. No commercial photo-agency asset was approved, downloaded into the project, or substituted.

**Stop decision:** the targeted search ends with a concrete free diagram candidate and no verified photograph candidate. If “photo” is literal, the blocker remains. If original financial-market diagrams count as images, this exact pair is a plausible third independent publisher candidate, subject to product acceptance and implementation verification outside this research task.

## Artifacts and capture status

- Project deliverable: `docs/focus-stock-image-rights-followup.md` only. No application/configuration files changed; no builds or integration tests run.
- Scratch evidence: `C:/Users/user/AppData/Local/Temp/stocks-rights-evidence/` contains fetched response bodies, extracted text and the inspected PNG. Citation ledger: `C:/Users/user/AppData/Local/Temp/stocks-rights-ledger.json`. These are research scratch artifacts, not application assets.
- Mission Control capture **not completed**: `C:/Users/user/.Codex/rules/common/research-capture.md` was missing, and a targeted filename search under `.Codex` found no replacement. No posting command or endpoint was invented.
- Tool limitation: configured `web_extract` reported that the search-only backend cannot extract content; direct HTTP was used. BeautifulSoup was unavailable; standard-library parsing was used instead. No dependency installation was performed.

## Sources

[17] https://www.federalreserve.gov/disclaimer.htm
    > "Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information."
    > "For any photo, graphic, or other material that is identified as being associated with a non-Board (such as materials with a copyright or trademark) permission to copy and distribute such photo, graphic, or material must be obtained from the non-Board source."
[18] https://www.federalreserve.gov/feeds/feds_notes.xml
    > "Wed, 26 Aug 2026 18:30:00 GMT"
[20] https://www.federalreserve.gov/econres/notes/feds-notes/repo-markets-and-the-feds-balance-sheet-implications-for-monetary-policy-implementation-20260826.html
    > "A simplified example of this mechanism is shown in stylized T-accounts in Figure 1."
    > "Disclaimer: FEDS Notes are articles in which Board staff offer their own views and present analysis on a range of topics in economics and finance."
[22] https://www.federalreserve.gov/econres/notes/feds-notes/fig1-4069.png
[23] https://www.federalreserve.gov/econres/notes/feds-notes/repo-markets-and-the-feds-balance-sheet-implications-for-monetary-policy-implementation-accessible-20260826.htm
    > "This diagram illustrates how Treasury securities move from the Fed's balance sheet to dealers, funded by repo agreements with MMFs, while bank reserves and deposits decline."
[24] https://www.federalreserve.gov/econres/sriya-l-anbil.htm
    > "Economist Board of Governors of the Federal Reserve System 2015 - present"
