import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

async function openPerson(page: import("@playwright/test").Page, name: string) {
  await page.goto("/team");
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name: "Points and KPIs" })).toBeVisible();
}

test("a person's scorecard shows KPIs, the ledger and records an adjustment with a reason", async ({ page }) => {
  await seed(page);
  await openPerson(page, "Sara Haddad");
  const kpis = page.getByRole("list", { name: "KPIs" });
  await expect(kpis.getByText("Points delivered", { exact: true }).first()).toBeVisible();
  await expect(kpis.getByText("On-time delivery", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Led the staging outage post-mortem; no issue tracks it")).toBeVisible();
  await page.getByRole("button", { name: "Adjust points" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Points").fill("2");
  await dialog.getByLabel("Reason").fill("Mentored the new hire through the module contract");
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  await expect(page.getByRole("list", { name: "Points ledger" }).getByText("Mentored the new hire through the module contract")).toBeVisible();
});

test("a starter set of KPIs and a bonus draft that needs approval", async ({ page }) => {
  await seed(page);
  await openPerson(page, "Youssef Nasser");
  await page.getByRole("button", { name: "Add a starter set" }).click();
  const kpis = page.getByRole("list", { name: "KPIs" });
  await expect(kpis.getByRole("listitem")).toHaveCount(3);
  // A bonus is a draft until approved.
  await page.getByRole("button", { name: "Adjust points" }).click();
  await page.getByRole("dialog").getByLabel("Points").fill("1");
  await page.getByRole("dialog").getByLabel("Reason").fill("Correction");
  await page.getByRole("dialog").getByRole("button", { name: "Record adjustment" }).click();
  await expect(page.getByRole("list", { name: "Points ledger" }).getByText("Correction")).toBeVisible();
});

test("creating an assigned issue with points says which KPIs it counts toward", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Issue title").fill("Points flow from Playwright");
  await dialog.getByRole("group", { name: "Points" }).getByRole("button", { name: "5", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Assignee" }).click();
  await page.getByRole("option", { name: "Sara Haddad" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Counts toward Sara Haddad's KPIs")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search or type a command…").fill("Points flow from Playwright");
  await page.getByRole("option", { name: /Points flow from Playwright/ }).first().click();
  await expect(page.getByText("Counts toward", { exact: true })).toBeVisible();
  await expect(page.getByText("Earns", { exact: false }).first()).toBeHidden();
  await expect(page.getByRole("link", { name: "Points delivered" })).toBeVisible();
});

test("the People page lists points and scores by name, and settings change the scale", async ({ page }) => {
  await seed(page);
  await page.goto("/team");
  await expect(page.getByRole("region", { name: "Points and KPIs" }).getByText("Listed by name, never ranked.", { exact: false })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Points and bonuses" })).toBeVisible();
  await page.getByRole("combobox").filter({ hasText: "Fibonacci" }).click();
  await page.getByRole("option", { name: /T-shirt sizes/ }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog").getByRole("group", { name: "Points" }).getByRole("button", { name: "XS" })).toBeVisible();
});
