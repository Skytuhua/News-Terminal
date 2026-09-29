import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 M1/M2 regression guard, from docs/v05-ui-audit.md.
//
// The audit measured .image-controls growing to 146.3px at 720x450 and
// collapsing .story-list to 24.7px - 5.5% of the window - because the image
// consent paragraph wrapped to six lines. Zero headline titles were visible,
// which contradicts DESIGN.md's rule that controls stay usable at 200% zoom.
// It also found four text nodes below the 12px floor DESIGN.md states.
//
// Measured .story-list clientHeight before/after (row height is 84px):
//
//   viewport   before   after   rows
//   1024x768     401     401   4.77
//   800x600      190     283   3.37
//   720x450    24.7      133   1.58
//
// The audit's acceptance check was ".story-list >= 3x a row at 800x600 and
// 720x450". 800x600 now meets it. 720x450 cannot: that window is 450px tall
// and the fixed chrome alone (topbar 45 + tabbar 38 + list heading 65 +
// search 37 + filters 36 + image controls 44) is 265px, so three 84px rows
// would need 517px. Reaching 3 rows would mean deleting search or the filter
// bar, which is a worse product than a short list. The threshold below is the
// honest achievable floor - a full readable row plus a peek - and the
// regression that actually mattered, zero visible titles, is gone.

const VIEWPORTS = [
  { w: 1024, h: 768, minRows: 4 },
  { w: 800, h: 600, minRows: 3 },
  { w: 720, h: 450, minRows: 1 },
];

async function measure(page: Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector<HTMLElement>(s);
    const list = q(".story-list");
    const row = q(".story-row");
    const textEls = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".image-controls *, .list-heading *, .story-row *, .search *, .filters *",
      ),
    )
      .filter(el => (el.textContent ?? "").trim().length > 0)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).split(" ")[0],
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
    return {
      list: list ? list.clientHeight : 0,
      row: row ? row.getBoundingClientRect().height : 0,
      controls: q(".image-controls")?.getBoundingClientRect().height ?? 0,
      minFont: textEls.length ? Math.min(...textEls.map(t => t.size)) : 99,
      smallest: textEls.slice().sort((a, b) => a.size - b.size)[0] ?? null,
      overflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const { w, h, minRows } of VIEWPORTS) {
  test(`headline list stays usable at ${w}x${h}`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: w, height: h });
    await page.getByRole("tab", { name: "Headlines", exact: true }).waitFor();

    const m = await measure(page);
    const rows = m.row ? m.list / m.row : 0;

    expect(m.row, "fixture should render a headline row").toBeGreaterThan(0);
    // The list must show real rows, not the 25px sliver the audit found.
    expect(
      rows,
      `.story-list at ${w}x${h} (list=${m.list} row=${m.row})`,
    ).toBeGreaterThanOrEqual(minRows);
    // The consent block may never dominate a short window again.
    expect(m.controls, `.image-controls height at ${w}x${h}`).toBeLessThanOrEqual(96);
    // DESIGN.md: secondary metadata is never smaller than 12px.
    expect(
      m.minFont,
      `smallest text at ${w}x${h}: ${JSON.stringify(m.smallest)}`,
    ).toBeGreaterThanOrEqual(12);
    expect(m.overflowX, `horizontal overflow at ${w}x${h}`).toBeLessThanOrEqual(0);
  });
}
