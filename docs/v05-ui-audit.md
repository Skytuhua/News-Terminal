# v0.5 UI/UX + visual-craft audit — News Terminal 0.4.0

**Date:** 2026-09-26 · **Baseline:** v0.4.0, working tree unmodified
**Register:** product (design serves the task) · **Quality bar:** daily-use polish, not MVP
**Status:** findings only. **No application source was modified.**

---

## 1. Method and evidence

Driven in Chromium via Playwright against a real Vite dev server on **port 1431**. The repository's own
`playwright.config.ts` (port 1420) was never started or modified. All data was synthetic, injected through the
existing `tests/e2e/fixture.ts` IPC seam. The packaged Tauri app was never launched and no production appdata was
read. Per `DESIGN.md`, **nothing here is evidence about native behaviour** — window detachment, monitor moves and
real IPC are out of scope.

Every viewport was captured at **CSS size × `deviceScaleFactor: 2`**, so 1440×900 is a 2880×1800 bitmap — the 200%
equivalent Windows users actually get. Twelve surfaces per viewport: shell, reader, keyboard focus walk, search
failure, empty state, live panel, briefing, hidden stories, three settings panels, and (≤900px) the nav drawer.

| Viewport | CSS px | DPR | Bitmap | `.story-list` client height | Chrome above list | Console / page errors |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 1440×900 | 2 | 2880×1800 | 573px | 274.8px (31%) | 0 |
| 1280×800 | 1280×800 | 2 | 2560×1600 | 458px | 289.2px (36%) | 0 |
| 1024×768 | 1024×768 | 2 | 2048×1536 | 373px | 341.6px (44%) | 0 |
| 800×600 | 800×600 | 2 | 1600×1200 | **190px** | 356.2px (59%) | 0 |
| 720×450 | 720×450 | 2 | 1440×900 | **25px** | 371.2px (82%) | 0 |

**59 screenshots** (`docs/evidence/v05-ui-<viewport>-<NN>-<surface>.png`) and **11 metric dumps**
(`docs/evidence/v05-ui-metrics-*.json`).

### Corrections to the previous pass

The prior run's numbers were re-derived from scratch, and two of its claims did not survive:

- **Motion was measured under `prefers-reduced-motion: reduce`.** That emulation applies
  `transition: none !important` (`src/styles.css:1244-1252`), so "0 transitioned elements" proved nothing. Re-measured
  with `reducedMotion: "no-preference"`: still **0 transitioned, 0 animated**. The finding survives, now on sound
  evidence (`v05-ui-metrics-motion.json`).
- **DPR was 1 at four of five viewports.** All captures are now DPR 2. It surfaced a real defect the DPR-1 run
  understated — see **M3**.

One prior claim I could **not** reproduce and have dropped: the "136px text-column jump when a thumbnail is present"
(`daily-use.css:6` collapses the grid via `:not(:has(.row-thumbnail))`). In every state my probe did capture the
list column was uniformly stable — a single left edge at all four viewports (227px at 1440/1024, 18px at 800/720).
The CSS rule is real and the risk is real, but I have no capture that demonstrates it, so it is not filed as a
finding. Closing it needs a deliberate mixed-media capture.

Contrast was resolved through a **1×1 canvas sRGB readback**. Chromium returns these tokens as `oklch()`, and a
naive rgb regex parse reports every pair as 1.0:1 — a silent false pass across the whole app.

---

## 2. Audit health score

| # | Dimension | Score | Key finding |
| - | -------- | ---- | ----------- |
| 1 | Accessibility | 3/4 | 23/23 focus rings visible, **zero** contrast failures; sub-12px type and 4px dividers are the deductions |
| 2 | Performance | 3/4 | Memoised rows, `overflow-anchor: none`, IntersectionObserver-gated media; structural evidence only — not paint/input profiled |
| 3 | Responsive design | **2/4** | Zero horizontal overflow anywhere, but the headline list collapses to **25px at 200% zoom** |
| 4 | Theming | 3/4 | Real 9-token OKLCH system, all text pairs pass; `--line` bottoms out at 1.16:1 and raw literals live outside `:root` |
| 5 | Anti-patterns | 4/4 | No AI-slop tells. One consistent hairline-and-accent language |
| | **Total** | **15/20** | **Good — address the weak dimension (responsive density)** |

### Anti-patterns verdict

**Pass.** This does not look AI-generated. No gradient text, no glassmorphism, no nested cards, no hero-metric
template, no identical card grid, no uppercase-tracked eyebrow above every section, no cream/sand body, no
over-rounded corners, no `repeating-linear-gradient` decoration. Headlines are rows with hairline dividers, exactly
as `DESIGN.md` specifies. An accent census found only **7 accent sites app-wide** (`.nav-heading`, `.chosen`, the
Watchlists label, the list `h2`, the Visual toggle border, two unread dots) — the accent is *not* overused,
contrary to what a first read of the stylesheet suggests. The one real taste problem is **S1**, where a pane label
outranks the content it labels.

---

## 3. What is already good — do not regress

Measured, not assumed. These are the reason this scores 15/20 rather than 9/20.

1. **Contrast is genuinely excellent — zero failures, anywhere.** All 12 surfaces × 5 viewports returned an empty
   contrast-failure list. Worst text pair is `--muted` on `--selected` at **6.19:1**; `--text` on `--bg` is 15.06:1,
   `--accent` on `--bg` 10.77:1, `--danger` on `--surface` 9.20:1. This app is not a legibility problem.
2. **Focus visibility is exemplary.** 23/23 tab stops carry `outline: 2px solid oklch(0.82 0.14 78)` at
   `outline-offset: 2px`, all in-viewport, zero exceptions. The `.search:focus-within` rule rings the *container*
   instead of killing the input's own outline — a subtle thing most apps get wrong.
3. **No horizontal overflow at any viewport**, and nothing paints outside its scroll container. The only truncation
   anywhere is the intentional tab-title ellipsis.
4. **Zero console errors and zero page errors** across 59 captures.
5. **Empty, loading, error and unavailable states explain themselves and offer a recovery action.** `EmptyHeadlines`
   is a genuinely well-built filter-aware/saved-aware/hidden-aware state machine, and the settings dialog restores
   focus on close.
6. **Long multilingual titles survive intact.** A 96-character mixed Japanese/Latin title wraps to two lines in the
   list and four in the reader with no clipping at any width — `overflow-wrap: anywhere` is doing its job.
7. **The settings dialog does not feel like a foreign object.** Type scale, control sizes and token usage match the
   app shell; the source-health rows are dense in a way a daily user can scan.
8. **Density at 1440×900 is right.** 573px of list in a 900px window, three rows visible plus a hairline divider
   rhythm. This is what a daily-use news reader should feel like.

---

## 4. Ranked backlog

Severity: **M** = must-fix (legibility or interaction), **S** = should-fix (hierarchy/density),
**N** = nice-to-have (delight).

### 4.1 Must-fix — legibility and interaction

| Before | After | Why | File | Acceptance check |
| --- | --- | --- | --- | --- |
| `.image-controls` is `flex-shrink: 0` and its 11px consent copy wraps to 6 lines, so the bar grows **47.8 → 63.2 → 115.6 → 131 → 146.3px** as the window narrows, squeezing `.story-list` to **25px at 720×450** (5.5% of the window, against 361px of content) and 190px at 800×600. At 720×450 **zero headline titles are visible** — only a publisher/date line | One-line summary plus `<details>` for the full warning, which already exists in Settings → Image preferences. Cap `.image-controls` at 44px with images off | The primary task — scanning headlines — is unusable at 200% zoom. `DESIGN.md` explicitly promises "Controls remain reachable at 200% zoom"; today the list is not reachable. Visible in `v05-ui-720x450-01-shell.png` | `src/daily-use.css:1-3`, `src/MediaSession.tsx:49-62`, `src/styles.css:44` | At 800×600 and 720×450, `.story-list` clientHeight ≥ 3× row height and `.image-controls` ≤ 44px |
| 11px consent copy, 11px Visual/Compact/"Enable automatic images" buttons, 9px credit caption, 10px "Images paused" placeholder — the only four sub-12px text nodes in the entire app | Minimum 12px | `DESIGN.md` sets its own floor: "secondary metadata no smaller than 12px". Four measured violations of a stated invariant. Contrast is fine (7.63:1) — this is purely scale | `src/daily-use.css:2-3, 10-12` | No text node under 12px on any surface; assert in the e2e sweep |
| Sidebar clips the **"Watchlists" heading mid-glyph at 1024×768**: `nav` scrollHeight 471 vs clientHeight 410, `overflow-y: auto` with `mask-image: none` and no fade, so the boundary is unmarked. "Climate desk" (y 646–677) is **fully hidden** | Reserve nav height, or mark the scroll boundary with a fade and let the heading scroll as a unit | A half-drawn heading reads as a rendering fault, and the whole watchlist section looks unreachable at a mainstream laptop size. Visible in `v05-ui-1024x768-01-shell.png` | `src/styles.css:283-307, 299`, `src/daily-use.css:31` | No nav child extends past the nav client box at 1440/1280/1024, **or** a visible affordance marks the boundary |
| `.pane-divider` is a **4px** strip painted in `--surface` — the same token as the sidebar and tab bar, so it is invisible against the reader pane, and offers 4px of pointer target for a primary layout interaction (measured `4x786`) | Widen the hit area to ≥8px with a padded hitbox (visual can stay hairline); show a persistent affordance instead of only `background: var(--accent)` on hover | 4px is below a reliable grab target. Keyboard operation already works, so this is pointer-only | `src/styles.css:1102-1110`, `src/PaneDivider.tsx:22-30` | Pointer hit area ≥8px wide; affordance visible without hover |
| `.new-items` "N new stories · Show latest" is `position: absolute; right: 18px; bottom: 16px` **over** the list. At 800×600 it **overlaps row 2 with 5187px² of intersection and covers its headline text**; at 720×450 it covers 48.6% of the list width | Put the pill in flow in the filter bar, or reserve `padding-bottom` on `.story-list` equal to its height while pending | It obscures the content it is announcing. Measured intersection, visible in `v05-ui-800x600-01-shell.png` | `src/styles.css:651-661`, `src/App.tsx:1132-1137` | Zero intersection area between `.new-items` and any `.story-row` at all five viewports |
| Source checkboxes are **13×13px** (measured in Sources & health and again in Preferences) | 16px box inside a ≥30px label hit area, keeping the native control | A 13px target is below a comfortable pointer target and fails WCAG 2.5.8 Target Size Minimum (24×24) | `src/styles.css:44-56`, `src/Settings.tsx` source and preference rows | Every checkbox ≥24×24 including its label hit area |

### 4.2 Should-fix — hierarchy and density

| Before | After | Why | File | Acceptance check |
| --- | --- | --- | --- | --- |
| Hierarchy inversion: the pane label "Headlines" (`.list-heading h2`, **16px, accent**) outranks the story titles it labels (14px/600, `--text`); the reader's story title is also 16px — identical to the pane label | Raise `.headline` to 15–16px/600 and drop the accent on `.list-heading h2` to `--text` | The app's most important content is currently among the quietest things on screen. Same conceptual weight should get the same visual weight | `src/styles.css:1138-1143, 1115-1117` | Computed `.headline` size > `.list-heading h2` size at 1440 |
| Control heights measured at **24, 30, 31, 32.8, 36, 52, 73, 94px** for `button` and **26, 35px** for `select` in a single view | One `--control-h: 30px` for all buttons and selects | Product register bans inconsistent component vocabulary. Nine heights for one component is the clearest craft signal in the app | `src/styles.css:44-56, 384`, `src/daily-use.css:42` | All buttons/selects within 1px of each other; nothing under 28px |
| Reader prose measures **46.4ch**; list headlines reach **103.1ch** at 1440 | Cap the reader column at 68–72ch centred; clamp `.headline` to ~72ch / 2–3 lines | 46ch is cramped for sustained reading; 103ch is past any comfortable headline length. `DESIGN.md` caps prose at 75ch | `src/styles.css:246, 1097-1100, 1143` | `.excerpt` lands in 65–75ch; `.headline` ≤ 75ch |
| Sticky global banner shows a raw stringified error — `Error: Fixture service unavailable` — with **no operation noun**, spanning the full 1440px with the dismiss ✕ 16px from the right edge. `Briefing` prefixes its own errors; the app-level banner does not | Prefix with the operation ("Search failed —"), keep ✕ adjacent to the text | In the captures the banner and the "No cached matches" empty state read as one undifferentiated failure | `src/App.tsx:885-898` | Every banner string opens with an operation noun |
| The `Switch tab` select (130×26) renders at **every** width, including 1440 where all three tabs are visible and labelled | Render it only when `.tabs` actually overflows | Two controls for one state, and the 26px select is off-vocabulary against 30px buttons | `src/App.tsx:826-840`, `src/styles.css:239-243` | At 1440 with 3 tabs the picker is absent; it returns when `.tabs` scrollWidth > clientWidth |
| `.list-heading` gets `background: var(--surface)` **+** `border-bottom` **+** `margin-bottom: 12px`, immediately followed by a surface-coloured search field — three bands separated three different ways | Keep one separator (drop the margin, or the border) | Reads as a confused stack in the capture | `src/styles.css:338-343, 1138`, `src/daily-use.css:1` | At most two of {surface band, border, margin} in the list header |
| Status bar: `Last refresh 9/26/2026, 12:28:04 AM` (26-char locale datetime) in a 31px strip; `{n} enabled sources` has no singular form; a permanent static `Local cache · No account required` sits in a `role="status"` live region | Use `compactDate` (already used in rows); pluralize; move the static claim to Help | Noise in the one strip that should be glanceable, and a static string in a live region is an a11y smell | `src/App.tsx:1329-1345`, `src/model.ts:44-48` | Status-bar items ≤16 chars; "1 enabled source" renders singular |
| Recovery surface out-types the primary one: `.hidden-row h3` is 15px/600 vs `.headline` 14px/600, padded 16/20 vs 10/18 | Match `.story-row` rhythm and type; let only the Restore button be larger | Two list surfaces should feel like one system | `src/daily-use.css:38-42`, `src/styles.css:1143` | `.hidden-row h3` ≤ `.headline` size |

### 4.3 Nice-to-have — delight

| Before | After | Why | File | Acceptance check |
| --- | --- | --- | --- | --- |
| **Zero motion app-wide**, now confirmed with reduced-motion *not* emulated: 0 transitioned elements, 0 animations, `transition-duration: 0s` everywhere. `DESIGN.md` correctly forbids motion for repeated keyboard/tab/search actions — but `button:hover`/`:active` are also instant, so a click gets no tactile confirmation | 120–160ms `ease-out` on `background-color`/`border-color` for pointer interaction, plus `transform: scale(0.97)` on `:active` for icon buttons, gated behind `@media (hover: hover) and (pointer: fine)`. Keep tab switching, J/K and search unanimated | Emil: buttons must feel responsive. This is pointer feedback, not decoration, and it costs one rule | `src/styles.css:44-56` | `transition-duration` non-zero for `background-color`; tab switch and J/K still instant |
| `--line` measures **1.16:1** on `--selected`, 1.29:1 on `--raised`, 1.43:1 on `--surface`, 1.50:1 on `--bg` | Add `--line-strong` (≥3:1) for control boundaries and the pane divider; keep `--line` for row dividers | Row dividers are decorative and fine. But 1.16:1 is invisible for a control boundary (WCAG 1.4.11 territory) | `src/styles.css:14` | Control borders ≥3:1 against their surface; row dividers unchanged |
| Token drift: raw `oklch()` literals sit outside `:root` (e.g. `button:hover`, `.primary`); `.primary` sets its own text colour separately from its background | Add tokens for hover/pressed pairs; let `.primary` own one contrast pair | Raw literals outside `:root` drift silently and bypass the token audit | `src/styles.css:46, 1135-1136` | No raw `oklch()` outside `:root` and deliberate state pairs |
| With images off, every row reserves a 124×84 "Images paused" box, a 10px label and a 9px "Credit: …" line | One muted line ("Images paused · enable in settings") or no placeholder | The row should be publisher / title / age only until an image is actually loaded | `src/StoryThumbnail.tsx:33-42`, `src/daily-use.css:7-12` | Paused rows carry no empty image frame |
| The settings `<dialog>` opens with no transition — the one surface where motion is affordable (occasional, per Emil's frequency table) | 150ms `opacity` + `scale(0.98→1)`, `transform-origin: center` (modals stay centred) | Rare enough to delight, cheap enough to feel native | `src/Settings.tsx:86-98` | Opens in ~150ms; instant under `prefers-reduced-motion` |

---

## 5. Explicitly not recommended

- **A light theme.** The dark surface is a stated scene decision in `DESIGN.md` (sustained desk reading, one or
  more monitors), not an accident. Adding a light theme is a product decision, not polish.
- **Animation on tab switching, J/K navigation, or search.** Already forbidden by `DESIGN.md`, and correct:
  these run hundreds of times a day. Don't undo the right call while fixing **N1**.
- **Larger minimum tap targets across the board.** This is a mouse-driven Windows desktop app. 30px is
  appropriate; chasing 44px would cost density the product depends on. Only the genuinely broken targets
  (4px divider, 13px checkboxes) are in scope.
- **Modal → inline for settings.** The `<dialog>` works, restores focus, and is keyboard-correct. Not worth
  the churn.
- **Closing the thumbnail column-jump question from the previous report.** I could not reproduce it; see §1.

---

## 6. Re-running this audit

The harness is throwaway and has been deleted. To reproduce: create a Playwright config with
`baseURL: http://127.0.0.1:1431`, `deviceScaleFactor: 2`, a `webServer` running
`npx vite --port 1431 --strictPort --host 127.0.0.1 --mode test`, and a spec that calls `fixture(page, { v02: true })`
then patches state through `window.__TEST_PATCH__`, dispatching `new Event("data-changed")` after the patch. Four
gotchas worth recording — each cost this pass real time:

- **Patch the full state.** Patching only `articles` empties the list: the app keeps a `retainedArticles` copy after
  first load, and a later `data-changed` re-reads it. Patch `articles` **and** `sources` **and** `workspace`
  together, or the rows vanish and the capture silently records zero.
- **`getComputedStyle().color` returns `oklch(…)`** for these tokens; an rgb regex parse yields 1.0:1 for every
  pair. Resolve through a 1×1 canvas `fillRect` + `getImageData`.
- **`getByRole("textbox")` never matches the search field** — `type="search"` exposes role `searchbox`. This
  hangs to the test timeout rather than failing fast.
- **Do not emulate `prefers-reduced-motion` when measuring motion.** It applies `transition: none !important` and
  makes every motion probe return zero. Measure with `no-preference`, then flip to `reduce` for a second reading.

## 7. Evidence index

`docs/evidence/v05-ui-<viewport>-<NN>-<surface>.png` where viewport ∈
`1440x900, 1280x800, 1024x768, 800x600, 720x450` (all captured at `deviceScaleFactor: 2`) and surface ∈
`01-shell, 02-reader, 03-focus, 04-search-error, 05-empty, 06-live, 07-briefing, 08-hidden,
09-settings-sources, 10-settings-preferences, 11-settings-shortcuts, 12-nav-drawer, 14-thumbnail-rows`.

Measurements: `docs/evidence/v05-ui-metrics-*.json` — per-viewport dumps plus `-tokens.json` (contrast matrix and
accent census), `-motion.json`, `-overlap.json` (pill/row intersection), `-sidebar-1024x768.json` (nav clipping),
`-accent.json`, `-thumbnail.json`.

### Known gap

`12-nav-drawer` exists only for 800×600 and 720×450 — the drawer does not exist above 900px, which is correct
behaviour. `14-thumbnail-rows` covers 1440×900 and 1024×768 only. The mixed thumb/no-thumb capture that would
settle the dropped column-jump claim was not obtained; see §1.
