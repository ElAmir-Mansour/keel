import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

test("the graph draws on a canvas and its list view carries the same nodes", async ({ page }) => {
  await seed(page);
  await page.goto("/graph");
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.getByText(/\d+ nodes · \d+ links/)).toBeVisible();
  await page.getByRole("tab", { name: "List" }).click();
  const rows = page.getByRole("table", { name: "Graph as a table" }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(30);
});

test("a lens answers its question and selecting a result opens the details panel", async ({ page }) => {
  await seed(page);
  await page.goto("/graph");
  const insights = page.getByRole("region", { name: "Insights" });
  await insights.getByRole("button", { name: /Decisions no note argues for/ }).click();
  await expect(page).toHaveURL(/lens=decisions_without_notes/);
  const results = page.getByRole("list", { name: "Lens results" });
  await expect(results.getByRole("button").first()).toBeVisible();
  await results.getByRole("button").first().click();
  const panel = page.getByRole("region", { name: "Selected node" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open" })).toBeVisible();
  // Local graph depth survives a reload through the URL.
  await panel.getByRole("button", { name: "2", exact: true }).click();
  await expect(page).toHaveURL(/depth=2/);
  await page.reload();
  await expect(page.getByText("Local graph · depth 2")).toBeVisible();
});

test("find selects a node and shows its connections, and the PNG export downloads", async ({ page }) => {
  await seed(page);
  await page.goto("/graph");
  const find = page.getByLabel("Find a node");
  await expect(find).toBeVisible();
  // The shortcut is attached once the graph mounts; on a slow runner the first
  // press can land before that, so press again until the field has focus.
  await expect(async () => {
    await page.keyboard.press("f");
    await expect(find).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByLabel("Find a node").fill("Platform sync");
  await page.getByLabel("Find a node").press("Enter");
  const panel = page.getByRole("region", { name: "Selected node" });
  await expect(panel.getByRole("heading", { name: "Platform sync" })).toBeVisible();
  await expect(panel.getByText(/Links to · \d+/)).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  expect((await dl).suggestedFilename()).toMatch(/^keel-graph-.*\.png$/);
});
