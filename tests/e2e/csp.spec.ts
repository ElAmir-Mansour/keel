import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

// The Content-Security-Policy is enforced (next.config.ts). A violation in a
// main flow shows up as a console error, so this test walks the flows that
// load every kind of resource the app uses and fails on the first one.

test("the content security policy blocks nothing the app needs", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text.slice(0, 300));
  });
  await seed(page);
  await page.goto("/notes");
  await page.getByRole("link", { name: /Platform sync/ }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.goto("/timelines");
  await page.getByRole("link", { name: /Platform base — walking skeleton/ }).click();
  await page.getByRole("img", { name: "Platform base — walking skeleton" }).waitFor();
  await page.getByRole("tab", { name: "Management" }).click();
  await page.getByRole("img", { name: /Management view/ }).waitFor();
  await page.getByRole("button", { name: "Export" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PNG image", exact: true }).click();
  await dl;
  await page.goto("/graph");
  await page.waitForTimeout(800);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  expect(violations, violations.join("\n")).toEqual([]);
});
