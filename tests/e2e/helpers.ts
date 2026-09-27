import { expect, type Page } from "@playwright/test";

/** Load the sample workspace into a fresh browser context. */
export async function seed(page: Page) {
  await page.goto("/");
  const load = page.getByRole("button", { name: "Load sample data" });
  await expect(load).toBeVisible();
  await load.click();
  await expect(page.getByText("Open issues", { exact: true })).toBeVisible();
}

/** Open the Platform base project and return its id from the URL. */
export async function openPlatform(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: /Platform base/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  return page.url().split("/projects/")[1];
}
