import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  ListItemSyncDTO,
  ListSyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
} from "@logger/shared";
import { normalizeTitle } from "@logger/shared";
import { getDB, META_SYNC_CURSOR, setMeta } from "../local/db.js";

/**
 * Fixture builders + a seeder for the local replica. Every builder auto-assigns a distinct id
 * and rowSeq (monotonic, in call order) so tests can pass just the fields they care about.
 */

let nextId = 1;
let nextSeq = 1;

/** Reset the id/seq counters — call in `beforeEach` when a test asserts on exact ids. */
export function resetFixtureCounters(): void {
  nextId = 1;
  nextSeq = 1;
}

function base<T extends { id: number; rowSeq: number; version: number }>(over: Partial<T>): T {
  return { id: nextId++, rowSeq: nextSeq++, version: 1, ...over } as T;
}

export function makeEntity(over: Partial<EntitySyncDTO> = {}): EntitySyncDTO {
  const title = over.title ?? `Entity ${nextId}`;
  return base<EntitySyncDTO>({
    category: "movie",
    title,
    normalizedTitle: normalizeTitle(title),
    releaseYear: null,
    author: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...over,
  });
}

export function makePerson(name: string, over: Partial<EntitySyncDTO> = {}): EntitySyncDTO {
  return makeEntity({ category: "person", title: name, ...over });
}

export function makeLog(over: Partial<LogSyncDTO> = {}): LogSyncDTO {
  return base<LogSyncDTO>({
    entityId: 0,
    rating: null,
    date: "2024-01-01",
    notes: null,
    autoDelete: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    peopleIds: [],
    photoIds: [],
    albumIds: [],
    ...over,
  });
}

export function makePhoto(over: Partial<PhotoSyncDTO> = {}): PhotoSyncDTO {
  const id = over.id ?? nextId;
  return base<PhotoSyncDTO>({
    logId: null,
    albumId: null,
    url: `/api/photos/${id}.jpg`,
    thumbnailUrl: `/api/photos/${id}_thumb.webp`,
    originalName: `photo-${id}.jpg`,
    mimeType: "image/jpeg",
    size: 1000,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...over,
  });
}

export function makeAlbum(over: Partial<AlbumSyncDTO> = {}): AlbumSyncDTO {
  return base<AlbumSyncDTO>({
    title: `Album ${nextId}`,
    notes: null,
    dateStart: null,
    dateEnd: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    eventLogIds: [],
    personIds: [],
    ...over,
  });
}

export function makeNote(over: Partial<EntityNoteSyncDTO> = {}): EntityNoteSyncDTO {
  return base<EntityNoteSyncDTO>({
    entityId: 0,
    category: "general",
    body: "note",
    tag: null,
    eventDate: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  });
}

export function makeList(over: Partial<ListSyncDTO> = {}): ListSyncDTO {
  const name = over.name ?? "Shopping";
  return base<ListSyncDTO>({
    kind: "shopping",
    name,
    normalizedName: normalizeTitle(name),
    isDefault: false,
    latitude: null,
    longitude: null,
    radiusM: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  });
}

export function makeListItem(over: Partial<ListItemSyncDTO> = {}): ListItemSyncDTO {
  const text = over.text ?? "Eggs";
  return base<ListItemSyncDTO>({
    listId: 0,
    text,
    normalizedText: normalizeTitle(text),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  });
}

export interface SeedData {
  entities?: EntitySyncDTO[];
  logs?: LogSyncDTO[];
  photos?: PhotoSyncDTO[];
  albums?: AlbumSyncDTO[];
  notes?: EntityNoteSyncDTO[];
  lists?: ListSyncDTO[];
  listItems?: ListItemSyncDTO[];
  cursor?: string;
}

/** Write fixture rows straight into the local replica. */
export async function seedLocalDb(data: SeedData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["entities", "logs", "photos", "albums", "entityNotes", "lists", "listItems"],
    "readwrite",
  );
  await Promise.all([
    ...(data.entities ?? []).map((r) => tx.objectStore("entities").put(r)),
    ...(data.logs ?? []).map((r) => tx.objectStore("logs").put(r)),
    ...(data.photos ?? []).map((r) => tx.objectStore("photos").put(r)),
    ...(data.albums ?? []).map((r) => tx.objectStore("albums").put(r)),
    ...(data.notes ?? []).map((r) => tx.objectStore("entityNotes").put(r)),
    ...(data.lists ?? []).map((r) => tx.objectStore("lists").put(r)),
    ...(data.listItems ?? []).map((r) => tx.objectStore("listItems").put(r)),
  ]);
  await tx.done;
  if (data.cursor != null) await setMeta(META_SYNC_CURSOR, data.cursor);
}
