import { expect, test, type Page } from "@playwright/test";

// Persistent storage. navigator.storage is replaced before the app loads, so
// each test decides what the browser answers: whether the data is already
// persisted, whether persist() agrees, and how much space is used.

type Answers = { persisted: boolean; grant: boolean; usage: number; quota: number };
type Counted = Window & { __persistCalls?: number };

async function stubStorage(page: Page, answers: Answers) {
  await page.addInitScript((a: Answers) => {
    const real = navigator.storage;
    let persisted = a.persisted;
    (window as Counted).__persistCalls = 0;
    const fake = {
      persisted: async () => persisted,
      persist: async () => {
        (window as Counted).__persistCalls! += 1;
        if (a.grant) persisted = true;
        return persisted;
      },
      estimate: async () => ({ usage: a.usage, quota: a.quota }),
      getDirectory: real?.getDirectory?.bind(real),
    };
    Object.defineProperty(navigator, "storage", { configurable: true, value: fake });
  }, answers);
}

const persistCalls = (page: Page) => page.evaluate(() => (window as Counted).__persistCalls ?? 0);

test("Settings says plainly that an unpersisted, unbacked-up workspace may be cleared", async ({ page }) => {
  await stubStorage(page, { persisted: false, grant: false, usage: 5_242_880, quota: 1_073_741_824 });
  await page.goto("/settings");
  const storage = page.locator("#storage");
  await expect(storage.getByRole("heading", { name: "Storage" })).toBeVisible();
  await expect(storage.getByTestId("storage-status")).toHaveText("Not persistent. The browser may clear Keel's data to free up space.");
  await expect(storage.getByTestId("storage-usage")).toHaveText("5.2 MB used of 1.1 GB available");

  const warning = storage.getByRole("note");
  await expect(warning).toContainText("Your data lives only in this browser");
  await expect(warning).toContainText("The browser may clear it to free up space");
  await expect(warning.getByRole("link", { name: "Set up backups" })).toHaveAttribute("href", "#backups");

  // The browser refuses: the answer is shown, nothing breaks, and the warning stays.
  await storage.getByRole("button", { name: "Ask the browser to keep Keel's data" }).click();
  await expect(storage.getByText("The browser said no for now.", { exact: false })).toBeVisible();
  await expect(storage.getByTestId("storage-status")).toContainText("Not persistent");
  await expect(warning).toBeVisible();
  expect(await persistCalls(page)).toBe(1);

  await page.getByText("العربية", { exact: true }).click();
  await expect(storage.getByTestId("storage-status")).toHaveText("تخزين غير دائم. قد يمسح المتصفح بيانات Keel لتوفير المساحة.");
  await expect(warning.getByRole("link", { name: "إعداد النسخ الاحتياطي" })).toBeVisible();
});

test("a granted request makes the line persistent and drops the warning", async ({ page }) => {
  await stubStorage(page, { persisted: false, grant: true, usage: 80_000, quota: 300_000_000_000 });
  await page.goto("/settings");
  const storage = page.locator("#storage");
  await expect(storage.getByTestId("storage-usage")).toHaveText("80 kB used of 300 GB available");
  await storage.getByRole("button", { name: "Ask the browser to keep Keel's data" }).click();
  await expect(page.getByText("The browser will keep Keel's data")).toBeVisible();
  await expect(storage.getByTestId("storage-status")).toHaveText(/^Persistent\. The browser will not clear Keel's data/);
  await expect(storage.getByRole("note")).toHaveCount(0);
  await expect(storage.getByRole("button", { name: "Ask the browser to keep Keel's data" })).toHaveCount(0);
});

test("Keel asks the browser once, on the first write to the workspace", async ({ page }) => {
  await stubStorage(page, { persisted: false, grant: false, usage: 0, quota: 1_000_000_000 });
  await page.goto("/");
  const load = page.getByRole("button", { name: "Load sample data" });
  await expect(load).toBeVisible();
  expect(await persistCalls(page)).toBe(0);
  await load.click();
  await expect(page.getByText("Open issues", { exact: true })).toBeVisible();
  await expect.poll(() => persistCalls(page)).toBe(1);
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Issue title").fill("A second write does not ask again");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Created [A-Z]+-\d+/)).toBeVisible();
  expect(await persistCalls(page)).toBe(1);
});
