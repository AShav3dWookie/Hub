import { test, expect, type Page } from "@playwright/test";
import { readStore, syncFromSettings } from "./helpers/app";
import { addLog, assertReplicaClean, bootstrap, feedWhere } from "./helpers/writes";

/**
 * Entity notes (the person-page "Notes" section, including annually-recurring important dates)
 * are created / edited / deleted offline and persist on sync — even a note on a person who was
 * also created offline (temp entityId).
 */

test.beforeEach(async ({ page }) => bootstrap(page));

async function openPerson(page: Page, name: string) {
  await page.goto("/search");
  await page.getByRole("textbox").first().fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page).toHaveURL(/\/person\/-?\d+/);
}

test("offline: add a general note to a seeded person, then sync", async ({ page, context }) => {
  const tag = `note-gen-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await openPerson(page, "Bob");
  await page.getByPlaceholder(/Conversation topics/i).fill(`remember: ${tag}`);
  await page.getByRole("button", { name: "Add note" }).click();

  // Shows immediately offline once its category group is expanded.
  await page.getByRole("button", { name: /^General/ }).click();
  await expect(page.getByText(`remember: ${tag}`)).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.notes.some((n) => n.body === `remember: ${tag}`));
  const note = feed.notes.find((n) => n.body === `remember: ${tag}`);
  expect(note).toMatchObject({ category: "general" });
  expect(note!.id).toBeGreaterThan(0);
  await assertReplicaClean(page);
});

test("offline: an important-date note lands on the home widget and persists", async ({ page, context }) => {
  const tag = `note-date-${Date.now().toString(36)}`;
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const md = `${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const eventDate = `2000-${md}`;

  await context.setOffline(true);
  await openPerson(page, "Carol");
  await page.getByRole("combobox").selectOption("important_date");
  await page.getByPlaceholder(/Tag \(e\.g\. Birthday\)/i).fill(`Anniversary ${tag}`);
  await page.locator('input[type="date"]').fill(eventDate);
  await page.getByRole("button", { name: "Add note" }).click();

  // The home widget reads the replica — the offline note shows before any sync.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByText(`Anniversary ${tag}`)).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.notes.some((n) => n.tag === `Anniversary ${tag}`));
  const note = feed.notes.find((n) => n.tag === `Anniversary ${tag}`);
  expect(note).toMatchObject({ category: "important_date", eventDate });
  expect(note!.id).toBeGreaterThan(0);
  await assertReplicaClean(page);
});

test("offline: edit then delete a note across one offline session", async ({ page, context }) => {
  const tag = `note-ed-${Date.now().toString(36)}`;

  // Seed a synced note.
  await openPerson(page, "Dave");
  await page.getByPlaceholder(/Conversation topics/i).fill(`v1 ${tag}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await syncFromSettings(page);
  const seeded = await feedWhere(page.request, (f) => f.notes.some((n) => n.body === `v1 ${tag}`));
  const noteId = seeded.notes.find((n) => n.body === `v1 ${tag}`)?.id;
  expect(noteId).toBeGreaterThan(0);

  await context.setOffline(true);
  await openPerson(page, "Dave");
  await page.getByRole("button", { name: /^General/ }).click();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator("textarea").first().fill(`v2 ${tag}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`v2 ${tag}`)).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await context.setOffline(false);
  await syncFromSettings(page);
  await page.reload();
  await syncFromSettings(page);

  const feed = await feedWhere(
    page.request,
    (f) => f.deletions.some((d) => d.entityType === "entity_note" && d.id === noteId),
  );
  expect(feed.notes.some((n) => n.id === noteId)).toBe(false);
  expect(feed.deletions.some((d) => d.entityType === "entity_note" && d.id === noteId)).toBe(true);
  await assertReplicaClean(page);
  expect((await readStore<{ id: number }>(page, "logger", "entityNotes")).some((n) => n.id === noteId)).toBe(false);
});

test("offline: create a person and a note on that same new person", async ({ page, context }) => {
  const tag = `note-newp-${Date.now().toString(36)}`;

  await context.setOffline(true);
  // Create the person via a hang-out log tag (simplest path to a new person entity).
  await addLog(page, "hang_out", { title: `Meet ${tag}`, date: "2026-09-09", person: `New Friend ${tag}` });

  await openPerson(page, `New Friend ${tag}`);
  await page.getByPlaceholder(/Conversation topics/i).fill(`likes climbing ${tag}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.notes.some((n) => n.body === `likes climbing ${tag}`));
  const person = feed.entities.find((e) => e.title === `New Friend ${tag}`);
  const note = feed.notes.find((n) => n.body === `likes climbing ${tag}`);
  expect(person).toMatchObject({ category: "person" });
  expect(person!.id).toBeGreaterThan(0);
  expect(note!.entityId).toBe(person!.id); // the temp entityId resolved to the real person
  await assertReplicaClean(page);
});
