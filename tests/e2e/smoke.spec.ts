import { expect, test } from "@playwright/test";
import { openPlatform, seed } from "./helpers";

test("sample data fills the dashboard", async ({ page }) => {
  await seed(page);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Burn-up", { exact: true })).toBeVisible();
  await expect(page.getByText("Cumulative flow", { exact: true })).toBeVisible();
  await expect(page.getByText("Platform base").first()).toBeVisible();
});

test("C opens quick create and Enter saves an issue", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New issue" })).toBeVisible();
  await dialog.getByPlaceholder("Issue title").fill("Playwright created this issue");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Created [A-Z]+-\d+/)).toBeVisible();
});

test("the command palette searches and jumps", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search or type a command…").fill("tenant");
  await expect(page.getByRole("option", { name: /tenant/i }).first()).toBeVisible();
  await page.getByRole("option", { name: /Go to inbox|Inbox/ }).first().click();
  await expect(page).toHaveURL(/\/inbox/);
});

test("inbox triage with the keyboard", async ({ page }) => {
  await seed(page);
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  const before = await page.getByText(/\d+ to triage/).textContent();
  await page.keyboard.press("j");
  await page.keyboard.press("1");
  await expect(page.getByText(/Accepted [A-Z]+-\d+/)).toBeVisible();
  await expect(page.getByText(/\d+ to triage/)).not.toHaveText(before ?? "");
});

test("board drag moves an issue between columns", async ({ page }) => {
  await seed(page);
  const id = await openPlatform(page);
  await page.goto(`/projects/${id}/board`);
  const card = page.getByText("Arabic collation on person names", { exact: false }).first();
  await expect(card).toBeVisible();
  const target = page.getByText("Drop here").first();
  await expect(target).toBeVisible();
  await card.dragTo(target, { sourcePosition: { x: 20, y: 10 } });
  await expect(page.getByText("Drop here", { exact: true })).toHaveCount(1);
});

test("a note autosaves and wikilinks resolve", async ({ page }) => {
  await seed(page);
  await page.goto("/notes");
  await page.getByRole("link", { name: /Ideas for the launch checklist/ }).first().click();
  const editor = page.locator("textarea.editor-textarea");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const current = await editor.inputValue();
  await editor.fill(`${current}\n\n- [ ] Verify autosave and link [[ADR-1]]`);
  await expect(page.locator(".md a.wiki", { hasText: "ADR-1" }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator("textarea.editor-textarea")).toHaveValue(/Verify autosave and link \[\[ADR-1\]\]/);
});

test("posting a weekly update from the activity draft", async ({ page }) => {
  await seed(page);
  const id = await openPlatform(page);
  await page.goto(`/projects/${id}/updates`);
  await page.getByRole("button", { name: "Draft from activity" }).click();
  await expect(page.locator("textarea.editor-textarea")).toHaveValue(/## Shipped this week/);
  await page.getByRole("button", { name: "Post update" }).last().click();
  await expect(page.getByText("Update posted", { exact: true })).toBeVisible();
});

test("export downloads a JSON file and the theme persists", async ({ page }) => {
  await seed(page);
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  expect(download.suggestedFilename()).toMatch(/keel-export-.*\.json/);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(dark);
});
