import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";

// A real conflict needs two devices and a Supabase project, so these tests
// write what a sync would have kept straight into IndexedDB, then reload.

type Row = Record<string, unknown> & { id: string };
type Op = { store: string; get?: string; getAll?: true; put?: Row };

/** Run IndexedDB reads and writes against the app's database; the app's CSP rules out eval, so ops are data. */
function idb<T>(page: Page, ops: Op[]): Promise<T[]> {
  return page.evaluate(
    (ops) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("keel");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction([...new Set(ops.map((o) => o.store))], "readwrite");
          const requests = ops.map((o) => {
            const store = tx.objectStore(o.store);
            return o.put ? store.put(o.put) : o.getAll ? store.getAll() : store.get(o.get!);
          });
          tx.oncomplete = () => {
            open.result.close();
            resolve(requests.map((r) => r.result as T));
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    ops,
  );
}

test("a kept copy can be compared and restored from settings", async ({ page }) => {
  await seed(page);
  const [people] = await idb<Row[]>(page, [{ store: "people", getAll: true }]);
  const person = people[0];
  const now = new Date().toISOString();
  await idb(page, [
    {
      store: "syncConflicts",
      put: { id: "conflict-e2e", tbl: "people", recordId: person.id, title: person.name, data: { ...person, role: "Kept role from the other device" }, createdAt: now, updatedAt: now },
    },
  ]);

  await page.goto("/settings#conflicts");
  const list = page.locator("#conflicts");
  await expect(list.getByText(String(person.name))).toBeVisible();
  await list.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Kept role from the other device")).toBeVisible();
  await expect(dialog.getByText(String(person.role))).toBeVisible();
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText("Version restored")).toBeVisible();
  await expect(list.getByText(/^None\./)).toBeVisible();

  const [after] = await idb<Row>(page, [{ store: "people", get: person.id }]);
  expect(after.role).toBe("Kept role from the other device");
});

test("a note's losing text shows in its history as a sync conflict", async ({ page }) => {
  await seed(page);
  const [notes] = await idb<Row[]>(page, [{ store: "notes", getAll: true }]);
  const note = notes.find((n) => n.kind === "page") ?? notes[0];
  const now = new Date().toISOString();
  await idb(page, [
    { store: "noteVersions", put: { id: "version-e2e", noteId: note.id, title: note.title, body: "Text written on the other device", savedAt: now, updatedAt: now, label: "sync-conflict" } },
    { store: "syncConflicts", put: { id: "conflict-note-e2e", tbl: "notes", recordId: note.id, title: note.title, versionId: "version-e2e", createdAt: now, updatedAt: now } },
  ]);

  await page.goto("/settings#conflicts");
  const list = page.locator("#conflicts");
  await list.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Text written on the other device")).toBeVisible();
  await dialog.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`));
  await expect(page.getByRole("button", { name: /Sync conflict/ })).toBeVisible();
});
