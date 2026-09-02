import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { CATEGORY_FIELDS, type LoggableCategory, type SyncChangesResponse } from "@logger/shared";
import { gotoHome, outboxCount, readStore, serviceWorkerState } from "./app";

/**
 * Open the app, wait for the service worker to control the page and the first sync to fill the
 * replica, and confirm the outbox starts empty. Use in `beforeEach` for writes-tier specs.
 */
export async function bootstrap(page: Page) {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await expect
    .poll(() => readStore(page, "logger", "logs").then((r) => r.length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => outboxCount(page)).toBe(0);
}

/** The sync stores the writes tier can touch (photos excluded — no offline photo writes). */
export const WRITE_STORES = ["entities", "logs", "albums", "entityNotes"] as const;

export interface FeedRow {
  id: number;
  title?: string;
  entityId?: number;
  notes?: string | null;
  rating?: number | null;
  date?: string;
  autoDelete?: boolean;
  author?: string | null;
  releaseYear?: number | null;
  category?: string;
  tag?: string | null;
  eventDate?: string | null;
  body?: string;
  peopleIds?: number[];
  albumIds?: number[];
  eventLogIds?: number[];
  personIds?: number[];
}

/**
 * Poll {@link fullFeed} until `predicate` holds (or the timeout), then return that feed. Use
 * after `syncFromSettings` for server-state assertions — the push can report done a beat
 * before `GET /sync/changes` reflects it under load. On timeout it returns the last feed so
 * the caller's `expect()` still produces a useful diff.
 */
export async function feedWhere(
  request: APIRequestContext,
  predicate: (f: Awaited<ReturnType<typeof fullFeed>>) => boolean,
  timeoutMs = 15_000,
) {
  const start = Date.now();
  let feed = await fullFeed(request);
  while (!predicate(feed) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    feed = await fullFeed(request);
  }
  return feed;
}

/** Walk every page of the change-feed from scratch and flatten it. */
export async function fullFeed(request: APIRequestContext) {
  let cursor = "0";
  const out = {
    entities: [] as FeedRow[],
    logs: [] as FeedRow[],
    albums: [] as FeedRow[],
    notes: [] as FeedRow[],
    deletions: [] as SyncChangesResponse["deletions"],
  };
  for (;;) {
    // `&_t=` busts any HTTP caching of the change-feed by the APIRequestContext.
    const body = (await (
      await request.get(`/api/sync/changes?since=${cursor}&_t=${Date.now()}`)
    ).json()) as SyncChangesResponse;
    out.entities.push(...(body.changes.entities as FeedRow[]));
    out.logs.push(...(body.changes.logs as FeedRow[]));
    out.albums.push(...(body.changes.albums as FeedRow[]));
    out.notes.push(...(body.changes.entityNotes as FeedRow[]));
    out.deletions.push(...body.deletions);
    if (!body.hasMore) break;
    cursor = body.nextCursor;
  }
  return out;
}

async function replicaIsClean(page: Page): Promise<boolean> {
  for (const store of WRITE_STORES) {
    const rows = await readStore<{ id: number; _localDirty?: boolean; _localDeleted?: boolean }>(
      page,
      "logger",
      store,
    );
    if (!rows.every((r) => r.id > 0 && !r._localDirty && !r._localDeleted)) return false;
  }
  return true;
}

/** No temp ids and no un-pushed flags anywhere in the replica — polled, since a pull may lag. */
export async function assertReplicaClean(page: Page, timeoutMs = 12_000) {
  const start = Date.now();
  while (!(await replicaIsClean(page)) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300));
  }
  for (const store of WRITE_STORES) {
    const rows = await readStore<{ id: number; _localDirty?: boolean; _localDeleted?: boolean }>(
      page,
      "logger",
      store,
    );
    expect(rows.every((r) => r.id > 0), `${store}: a negative id survived`).toBe(true);
    expect(rows.every((r) => !r._localDirty), `${store}: a dirty row survived`).toBe(true);
    expect(rows.every((r) => !r._localDeleted), `${store}: a soft-deleted row survived`).toBe(true);
  }
}

export interface LogFields {
  title: string;
  notes?: string;
  person?: string;
  rating?: number;
  /** Year-granularity categories (tv / book / game). */
  year?: string;
  releaseYear?: string;
  author?: string;
  /** Day-granularity categories. Defaults to today. */
  date?: string;
  /** Appointment only; the checkbox defaults to checked — pass false to clear it. */
  autoDelete?: boolean;
}

/** Fill and submit the Add form for `category`, returning to the home hub. */
export async function addLog(page: Page, category: LoggableCategory, f: LogFields) {
  const cf = CATEGORY_FIELDS[category];
  await page.goto(`/add/${category}`);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

  await page.getByLabel("Title").fill(f.title);
  if (cf.hasReleaseYear && f.releaseYear) await page.getByLabel("Release Year").fill(f.releaseYear);
  if (cf.hasAuthor && f.author) await page.getByLabel("Author").fill(f.author);
  if (cf.hasRating && f.rating) {
    await page.getByRole("radio", { name: `${f.rating} star${f.rating > 1 ? "s" : ""}` }).click();
  }
  if (cf.dateGranularity === "year" && f.year) await page.getByLabel(cf.dateLabel).fill(f.year);
  if (cf.dateGranularity === "day" && f.date) await page.getByLabel(cf.dateLabel).fill(f.date);
  if (cf.hasAutoDelete && f.autoDelete === false) {
    await page.getByRole("checkbox").uncheck();
  }
  if (f.notes) await page.locator("textarea").first().fill(f.notes);
  if (cf.hasPeople && f.person) {
    const input = page.getByPlaceholder(/Add a person/i);
    await input.fill(f.person);
    await input.press("Enter");
  }

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
}

/** Create an album offline-or-online; returns after navigation to its detail page. */
export async function addAlbum(page: Page, title: string) {
  await page.goto("/add/album");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: /create album/i }).click();
  await expect(page).toHaveURL(/\/album\/-?\d+/);
}

/** Search for `title` and open the first matching entity / person page. */
export async function openEntity(page: Page, title: string) {
  await page.goto("/search");
  await page.getByRole("textbox").first().fill(title);
  await page.getByText(title, { exact: false }).first().click();
  await expect(page).toHaveURL(/\/(entity|person)\/-?\d+/);
}
