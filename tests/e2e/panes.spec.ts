import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: pane widths have keyboard resizing without a mouse", async ({
  page,
}) => {
  await fixture(page);
  const divider = page.getByRole("separator", { name: "Reading pane width" });
  await divider.focus();
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", String(before + 10));
  await page.keyboard.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "290");
});
