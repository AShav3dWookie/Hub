import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { albums, albumEvents, albumPeople, entities, logs, logPhotos } from "../db/schema.js";
import { getPeopleForLogs, resolvePersonIds, toLogWithEntity } from "./logService.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import type {
  AlbumDTO,
  AlbumSummary,
  CreateAlbumRequest,
  UpdateAlbumRequest,
  LogWithEntityDTO,
  PersonRef,
  PersonTagInput,
} from "@logger/shared";

type AlbumRow = typeof albums.$inferSelect;

function getAlbumRow(db: AppDb, id: number): AlbumRow {
  const row = db.select().from(albums).where(eq(albums.id, id)).get();
  if (!row) {
    throw new NotFoundError(`Album ${id} not found`);
  }
  return row;
}

/** The log ids linked to an album, for photo aggregation and counts. */
export function getLinkedLogIds(db: AppDb, albumId: number): number[] {
  return db
    .select({ logId: albumEvents.logId })
    .from(albumEvents)
    .where(eq(albumEvents.albumId, albumId))
    .all()
    .map((r) => r.logId);
}

function countAlbumPhotos(db: AppDb, albumId: number, linkedLogIds: number[]): number {
  const conditions = [eq(logPhotos.albumId, albumId)];
  if (linkedLogIds.length > 0) {
    conditions.push(inArray(logPhotos.logId, linkedLogIds));
  }
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(logPhotos)
    .where(or(...conditions))
    .get();
  return Number(row?.count ?? 0);
}

function validateDateRange(dateStart: string | null, dateEnd: string | null): void {
  if (dateStart && dateEnd && dateEnd < dateStart) {
    throw new BadRequestError("Album end date must not be before the start date");
  }
}

function toAlbumSummary(row: AlbumRow, eventCount: number, photoCount: number): AlbumSummary {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dateStart: row.dateStart,
    dateEnd: row.dateEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    eventCount,
    photoCount,
  };
}

export function getAlbumById(db: AppDb, id: number): AlbumDTO {
  const row = getAlbumRow(db, id);
  const linkedLogIds = getLinkedLogIds(db, id);

  // Linked events as LogWithEntityDTO[] — photos:[] + albums:[] (the album page shows the aggregated
  // photo stream, not per-event photos), sorted newest first.
  let events: LogWithEntityDTO[] = [];
  if (linkedLogIds.length > 0) {
    const logRows = db.select().from(logs).where(inArray(logs.id, linkedLogIds)).all();
    const entityIds = [...new Set(logRows.map((l) => l.entityId))];
    const entityById = new Map(
      db
        .select()
        .from(entities)
        .where(inArray(entities.id, entityIds))
        .all()
        .map((e) => [e.id, e]),
    );
    const peopleByLog = getPeopleForLogs(db, linkedLogIds);
    events = logRows
      .filter((r) => entityById.has(r.entityId))
      .map((r) => toLogWithEntity(r, peopleByLog.get(r.id) ?? [], entityById.get(r.entityId)!))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // People = directly-added ∪ tagged on any linked event, deduped by id, name-sorted.
  const directPeople = db
    .select({ id: entities.id, name: entities.title })
    .from(albumPeople)
    .innerJoin(entities, eq(albumPeople.personEntityId, entities.id))
    .where(eq(albumPeople.albumId, id))
    .all();
  const directPersonIds = directPeople.map((p) => p.id);

  const peopleById = new Map<number, PersonRef>();
  for (const p of directPeople) peopleById.set(p.id, { id: p.id, name: p.name });
  for (const list of getPeopleForLogs(db, linkedLogIds).values()) {
    for (const p of list) if (!peopleById.has(p.id)) peopleById.set(p.id, p);
  }
  const people = [...peopleById.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...toAlbumSummary(row, linkedLogIds.length, countAlbumPhotos(db, id, linkedLogIds)),
    events,
    people,
    directPersonIds,
  };
}

export function listAlbums(db: AppDb): AlbumSummary[] {
  const rows = db.select().from(albums).all();
  return rows
    .map((row) => {
      const linkedLogIds = getLinkedLogIds(db, row.id);
      return toAlbumSummary(row, linkedLogIds.length, countAlbumPhotos(db, row.id, linkedLogIds));
    })
    .sort((a, b) => {
      // Most recently created first — a plain reverse-chronological list.
      return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
    });
}

export function createAlbum(db: AppDb, input: CreateAlbumRequest): AlbumDTO {
  validateDateRange(input.dateStart ?? null, input.dateEnd ?? null);

  const inserted = db
    .insert(albums)
    .values({
      title: input.title.trim(),
      notes: input.notes ?? null,
      dateStart: input.dateStart ?? null,
      dateEnd: input.dateEnd ?? null,
    })
    .returning()
    .get();

  const personIds = resolvePersonIds(db, input.people ?? []);
  if (personIds.length > 0) {
    db.insert(albumPeople)
      .values(personIds.map((personEntityId) => ({ albumId: inserted.id, personEntityId })))
      .onConflictDoNothing()
      .run();
  }

  for (const logId of input.eventLogIds ?? []) {
    assertLogExists(db, logId);
  }
  const uniqueLogIds = [...new Set(input.eventLogIds ?? [])];
  if (uniqueLogIds.length > 0) {
    db.insert(albumEvents)
      .values(uniqueLogIds.map((logId) => ({ albumId: inserted.id, logId })))
      .onConflictDoNothing()
      .run();
  }

  return getAlbumById(db, inserted.id);
}

export function updateAlbum(db: AppDb, id: number, input: UpdateAlbumRequest): AlbumDTO {
  getAlbumRow(db, id);
  validateDateRange(input.dateStart ?? null, input.dateEnd ?? null);

  db.update(albums)
    .set({
      title: input.title.trim(),
      notes: input.notes ?? null,
      dateStart: input.dateStart ?? null,
      dateEnd: input.dateEnd ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(albums.id, id))
    .run();

  return getAlbumById(db, id);
}

export function deleteAlbum(db: AppDb, id: number): void {
  getAlbumRow(db, id);
  // album_events / album_people cascade; loose photos' album_id is SET NULL (become gallery orphans)
  // unless the route already removed them via deletePhotosForAlbum.
  db.delete(albums).where(eq(albums.id, id)).run();
}

function assertLogExists(db: AppDb, logId: number): void {
  const row = db.select({ id: logs.id }).from(logs).where(eq(logs.id, logId)).get();
  if (!row) {
    throw new BadRequestError(`Log ${logId} not found`);
  }
}

export function addAlbumEvent(db: AppDb, albumId: number, logId: number): AlbumDTO {
  getAlbumRow(db, albumId);
  assertLogExists(db, logId);
  db.insert(albumEvents).values({ albumId, logId }).onConflictDoNothing().run();
  return getAlbumById(db, albumId);
}

export function removeAlbumEvent(db: AppDb, albumId: number, logId: number): void {
  getAlbumRow(db, albumId);
  db.delete(albumEvents)
    .where(and(eq(albumEvents.albumId, albumId), eq(albumEvents.logId, logId)))
    .run();
}

export function addAlbumPerson(db: AppDb, albumId: number, person: PersonTagInput): PersonRef[] {
  getAlbumRow(db, albumId);
  const personIds = resolvePersonIds(db, [person]);
  if (personIds.length === 0) {
    throw new BadRequestError("A person id or name is required");
  }
  db.insert(albumPeople)
    .values(personIds.map((personEntityId) => ({ albumId, personEntityId })))
    .onConflictDoNothing()
    .run();
  return getAlbumById(db, albumId).people;
}

export function removeAlbumPerson(db: AppDb, albumId: number, personEntityId: number): void {
  getAlbumRow(db, albumId);
  db.delete(albumPeople)
    .where(and(eq(albumPeople.albumId, albumId), eq(albumPeople.personEntityId, personEntityId)))
    .run();
}
