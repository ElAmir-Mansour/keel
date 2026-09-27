import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

test("the dashboard fits a phone without horizontal scroll", async ({ page }) => {
  await seed(page);
  const { scrollW, innerW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
  expect(scrollW).toBeLessThanOrEqual(innerW);
  await page.getByRole("button", { name: /Toggle Sidebar/i }).click();
  await expect(page.getByRole("link", { name: "Decisions" })).toBeVisible();
});
