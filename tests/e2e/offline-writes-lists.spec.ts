import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { enterEditMode, outboxCount, syncFromSettings } from "./helpers/app";
import { assertReplicaClean, bootstrap, feedWhere } from "./helpers/writes";

/**
 * Shopping lists edited with no signal — the case they exist for — and pushed on reconnect.
 *
 * Every spec shares one server, so each test works on lists named after its own tag and puts
 * the main list back if it moved it.
 */

test.beforeEach(async ({ page }) => bootstrap(page));

const tagged = () => Date.now().toString(36);

/** Create a list (and items) on the server, then sync so the device has it before going offline. */
async function seedList(page: Page, name: string, items: string[]): Promise<number> {
  const created = await page.request.post("/api/lists", { data: { name } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: number };
  for (const text of items) {
    expect((await page.request.post(`/api/lists/${id}/items`, { data: { text } })).status()).toBe(201);
  }
  await syncFromSettings(page);
  return id;
}

async function mainListId(request: APIRequestContext): Promise<number> {
  const lists = (await (await request.get("/api/lists")).json()) as { id: number; isDefault: boolean }[];
  return lists.find((l) => l.isDefault)!.id;
}

const listRow = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(name) }) });

test("offline: add from the lists screen and tick off on the list, then sync", async ({ page, context }) => {
  const tag = tagged();
  const name = `Tesco ${tag}`;
  const id = await seedList(page, name, ["Eggs", "Milk"]);

  await context.setOffline(true);
  await page.goto("/shopping");
  await listRow(page, name).getByRole("button", { name: `Add to ${name}` }).click();
  const field = page.getByRole("textbox", { name: `Add an item to ${name}` });
  await field.fill("Bread");
  await field.press("Enter");
  await field.fill("eggs"); // already on the list — absorbed, not queued
  await field.press("Enter");
  await expect(listRow(page, name).getByText("3 items")).toBeVisible();

  await listRow(page, name).getByRole("link").click();
  await page.getByRole("button", { name: "Remove Eggs" }).click();
  await expect(page.getByText("Eggs", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("listitem")).toHaveText(["Milk", "Bread"]);
  await expect.poll(() => outboxCount(page)).toBe(2);

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) =>
    f.listItems.some((i) => i.listId === id && i.text === "Bread"),
  );
  expect(feed.listItems.filter((i) => i.listId === id).map((i) => i.text)).toEqual(["Milk", "Bread"]);
  await assertReplicaClean(page);
});

test("offline: create a list, fill it, rename it and make it main before it ever syncs", async ({
  page,
  context,
}) => {
  const tag = tagged();
  const originalMain = await mainListId(page.request);

  await context.setOffline(true);
  await page.goto("/shopping");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "New list name" }).fill(`Aldi ${tag}`);
  await page.getByRole("button", { name: "Create list" }).click();

  await listRow(page, `Aldi ${tag}`).getByRole("button", { name: `Add to Aldi ${tag}` }).click();
  const field = page.getByRole("textbox", { name: `Add an item to Aldi ${tag}` });
  for (const text of ["Apples", "Pasta"]) {
    await field.fill(text);
    await field.press("Enter");
  }
  await expect(listRow(page, `Aldi ${tag}`).getByText("2 items")).toBeVisible();

  await listRow(page, `Aldi ${tag}`).getByRole("link").click();
  await expect(page).toHaveURL(/\/shopping\/-\d+$/); // still a temp id — the server hasn't seen it
  await enterEditMode(page);
  const nameField = page.getByRole("textbox", { name: "List name" });
  await nameField.fill(`Aldi Bangor ${tag}`);
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByRole("button", { name: "Make main list" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Aldi Bangor ${tag}`) })).toContainText("Main");

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) =>
    f.lists.some((l) => l.name === `Aldi Bangor ${tag}` && l.isDefault),
  );
  const list = feed.lists.find((l) => l.name === `Aldi Bangor ${tag}`)!;
  expect(list.isDefault).toBe(true);
  expect(feed.lists.filter((l) => l.isDefault)).toHaveLength(1);
  expect(feed.listItems.filter((i) => i.listId === list.id).map((i) => i.text)).toEqual([
    "Apples",
    "Pasta",
  ]);
  await assertReplicaClean(page);

  // Put the main list back for the specs that follow.
  await page.request.patch(`/api/lists/${originalMain}`, { data: { isDefault: true } });
});

test("offline: delete a list and its items go with it, then sync", async ({ page, context }) => {
  const tag = tagged();
  const name = `Lidl ${tag}`;
  const id = await seedList(page, name, ["Coffee", "Tea"]);

  await context.setOffline(true);
  await page.goto(`/shopping/${id}`);
  await enterEditMode(page);
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page.getByText("Delete this list and its 2 items?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);

  await context.setOffline(false);
  await syncFromSettings(page);

  expect((await page.request.get(`/api/lists/${id}`)).status()).toBe(404);
  const feed = await feedWhere(page.request, (f) =>
    f.deletions.some((d) => d.entityType === "list" && d.id === id),
  );
  expect(feed.listItems.some((i) => i.listId === id)).toBe(false);
  await assertReplicaClean(page);
});

test("the main list can't be deleted, even offline", async ({ page, context }) => {
  const id = await mainListId(page.request);
  await context.setOffline(true);
  await page.goto(`/shopping/${id}`);
  await enterEditMode(page);
  await expect(page.getByText(/can't be deleted/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete list" })).toHaveCount(0);
});

test("a shop tagged from the phone shows on the list, and its radius and tag change offline", async ({
  page,
  context,
}) => {
  const tag = tagged();
  const name = `Morrisons ${tag}`;
  const id = await seedList(page, name, ["Bread"]);

  // Tag it the way the companion app does: with a device token, through /api/device.
  const device = (await (await page.request.post("/api/device-tokens", { data: { name: `Phone ${tag}` } })).json()) as {
    token: string;
  };
  const tagRes = await page.request.put(`/api/device/lists/${id}/location`, {
    headers: { Authorization: `Bearer ${device.token}` },
    data: { location: { latitude: 53.2274, longitude: -4.1293, radiusM: 75 } },
  });
  expect(tagRes.status()).toBe(200);
  await syncFromSettings(page);

  await page.goto(`/shopping/${id}`);
  await expect(page.getByText("Tagged to a shop · 75 m")).toBeVisible();

  await context.setOffline(true);
  await enterEditMode(page);
  const radius = page.getByRole("spinbutton", { name: "Shop radius (metres)" });
  await radius.fill("120");
  await page.getByRole("button", { name: "Save radius" }).click();
  await expect(page.getByText("Tagged to a shop · 120 m")).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);
  let feed = await feedWhere(page.request, (f) => f.lists.some((l) => l.id === id && l.radiusM === 120));
  expect(feed.lists.find((l) => l.id === id)).toMatchObject({ latitude: 53.2274, longitude: -4.1293, radiusM: 120 });

  await page.goto(`/shopping/${id}`);
  await enterEditMode(page);
  await page.getByRole("button", { name: "Clear location" }).click();
  await page.getByRole("button", { name: "Clear location" }).first().click();
  await expect(page.getByText(/Tagged to a shop/)).toHaveCount(0);
  await syncFromSettings(page);
  feed = await feedWhere(page.request, (f) => f.lists.some((l) => l.id === id && l.radiusM == null));
  expect(feed.lists.find((l) => l.id === id)).toMatchObject({ latitude: null, longitude: null, radiusM: null });
  await assertReplicaClean(page);
});
