# Reader selection and compact-window accessibility

The existing dark reading desk remains the design reference. This change repairs visible control state and compact-window behavior using its current theme tokens.

## Scope

- Reproduce missing bulk-row feedback caused by undefined theme tokens; use the existing palette consistently for selected controls, dividers, and secondary text.
- Keep the current row, tab, and navigation selection visible when Windows contrast themes replace background colors.
- Check a 320 CSS pixel window, which can occur when a 640 pixel detached window is zoomed to 200%. Keep toolbar actions reachable without clipping the reader.
- Keep state, host commands, and reader ordering in their existing owners. No data migration or network behavior changes.

## Verification

The three new browser regressions failed against the unchanged Windows baseline at 8834fbc: bulk selections retained a transparent background, the selected reader row had no persistent outline under forced-colors emulation, and the 320px viewport had a 360px document width. Screenshots confirmed the missing selection feedback and clipped compact reader.

The fallback Linux font also exposed an existing 800x600 density failure: both baseline and candidate provided 299px for 101px rows, just under three complete rows. Reducing row vertical padding on short windows restores three rows without shrinking text. At 320px, reader actions wrap as a group beneath the pane label.

The initial candidate passed all 13 focused browser checks: the three new regressions plus existing visual, density, and pane layout cases. TypeScript and the Vite production build passed. Desktop, compact-reader, compact-settings, bulk-selection, and forced-colors screenshots were inspected. The passing render checks used Linux Chrome for Testing 155.0.8059.84 because the pinned Playwright browser archive was unavailable in that environment. The original three failures were recorded on Windows before editing; Windows CI is a separate gate for the final change.

## Independent review

The persistent contrast-theme selection outline initially overrode the keyboard focus outline on selected buttons. Navigation, image-mode and settings buttons produced identical screenshots before and after keyboard focus, even with `:focus-visible` active. The fix retains the inner selection marker and adds an outer ring only during keyboard focus. The ring has no layout or pointer hit-area effect.

A fourth accessibility regression checks navigation, image-mode, settings-section and source-filter buttons. It compares each rendered control before, during and after focus, and verifies that the selection outline remains present. This regression failed before the focus fix. All four accessibility checks, TypeScript and diff checks pass afterward using the same Linux Chrome version on an isolated fixture server at port 1421. The earlier visual and density suites were not repeated for this focus-only change.

Browser evidence covers rendering and input; it does not establish physical display or native WebView2 acceptance.
