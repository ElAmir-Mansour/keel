import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

test("the sample timeline draws a chart with a today line and a story", async ({ page }) => {
  await seed(page);
  await page.goto("/timelines");
  await expect(page.getByRole("heading", { name: "Timelines" })).toBeVisible();
  await page.getByRole("link", { name: /Platform base — walking skeleton/ }).click();
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/);
  const chart = page.getByRole("img", { name: "Platform base — walking skeleton" });
  await expect(chart).toBeVisible();
  await expect(chart.locator("text", { hasText: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What happened" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What's next" })).toBeVisible();
});

test("typing a dated line adds an entry and the text view round-trips", async ({ page }) => {
  await seed(page);
  await page.goto("/timelines");
  await page.getByRole("button", { name: "New timeline" }).click();
  await page.getByPlaceholder("Timeline title, e.g. Q4 delivery").fill("Playwright timeline");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/);
  const quick = page.getByLabel("Add an entry");
  await quick.fill("2026-09-12: Kickoff #Design");
  await quick.press("Enter");
  await expect(page.getByText("Added “Kickoff”")).toBeVisible();
  await quick.fill("Oct 1 – Nov 15: Build phase #Build");
  await quick.press("Enter");
  await expect(page.getByText("Added “Build phase”")).toBeVisible();
  const chart = page.getByRole("img", { name: "Playwright timeline" });
  await expect(chart).toBeVisible();
  await expect(chart.locator("text", { hasText: "Kickoff" })).toBeVisible();
  await expect(chart.locator("text", { hasText: "DESIGN" })).toBeVisible();
  await page.getByRole("tab", { name: "Text" }).click();
  const text = page.getByLabel("Timeline as text");
  await expect(text).toHaveValue(/2026-09-12: Kickoff/);
  await expect(text).toHaveValue(/2026-10-01 \/ 2026-11-15: Build phase/);
});

test("export downloads a PNG and an SVG", async ({ page }) => {
  await seed(page);
  await page.goto("/timelines");
  await page.getByRole("link", { name: /Platform base — walking skeleton/ }).click();
  await expect(page.getByRole("img", { name: "Platform base — walking skeleton" })).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  const png = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PNG image", exact: true }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole("button", { name: "Export" }).click();
  const svg = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "SVG file" }).click();
  expect((await svg).suggestedFilename()).toMatch(/\.svg$/);
});

test("the PDF handout prints a document with the chart and the story", async ({ page }) => {
  // Stub print inside every frame: record what the frame held and fire afterprint.
  await page.addInitScript(() => {
    window.print = () => {
      type Printed = Window & { __printed?: { svg: boolean; text: string }[] };
      const top = (window.top ?? window) as Printed;
      top.__printed = top.__printed ?? [];
      top.__printed.push({ svg: Boolean(document.querySelector("svg")), text: document.body.textContent ?? "" });
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await seed(page);
  await page.goto("/timelines");
  await page.getByRole("link", { name: /Platform base — walking skeleton/ }).click();
  await expect(page.getByRole("img", { name: "Platform base — walking skeleton" })).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "PDF handout (print)" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __printed?: unknown[] }).__printed?.length ?? 0)).toBe(1);
  const printed = await page.evaluate(() => (window as Window & { __printed?: { svg: boolean; text: string }[] }).__printed![0]);
  expect(printed.svg).toBe(true);
  expect(printed.text).toContain("Platform base — walking skeleton");
  expect(printed.text).toContain("What happened");
  expect(printed.text).toContain("What's next");
  expect(printed.text).toContain("Exported from Keel");
});

test("the management view shows the slide with status, slippage and asks, and records a review", async ({ page }) => {
  await seed(page);
  await page.goto("/timelines");
  await page.getByRole("link", { name: /Platform base — walking skeleton/ }).click();
  await page.getByRole("tab", { name: "Management" }).click();
  const slide = page.getByRole("img", { name: /Management view: Platform base/ });
  await expect(slide).toBeVisible();
  await expect(slide.locator("text", { hasText: "Today" })).toBeVisible();
  await expect(slide.getByText("Decisions needed", { exact: true })).toBeVisible();
  await expect(slide.locator("text", { hasText: /\+12d/ }).first()).toBeVisible();
  await expect(slide.locator("text", { hasText: /Since \d+ \w+:/ })).toBeVisible();
  await expect(slide.locator("text", { hasText: /slipped/ })).toBeVisible();
  // The panel lists executive items with computed status and the baseline field.
  await expect(page.getByRole("heading", { name: /Executive items/ })).toBeVisible();
  await expect(page.getByLabel("Baseline").first()).toBeVisible();
  // Record a review for today; a chip appears.
  await page.getByRole("button", { name: /Record review as of/ }).click();
  await expect(page.getByText(/Review recorded as of/)).toBeVisible();
  await expect(page.getByText(/Review \d+ \w+ · \d+ items/).first()).toBeVisible();
  // Export the slide as PNG.
  await page.getByRole("button", { name: "Export" }).click();
  const png = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PNG image", exact: true }).click();
  expect((await png).suggestedFilename()).toMatch(/-management-.*\.png$/);
});
