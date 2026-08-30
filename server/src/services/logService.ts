import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople, albums, albumEvents } from "../db/schema.js";
import { findOrCreateEntity, getEntityById, toEntitySummary } from "./entityService.js";
import { getPhotosForLogs } from "./logPhotosService.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import type {
  CreateLogRequest,
  UpdateLogRequest,
  LogDTO,
  LogWithEntityDTO,
  LogPhotoDTO,
  AlbumRef,
  PersonRef,
  PersonTagInput,
} from "@logger/shared";
import { isLoggableCategory } from "@logger/shared";

/** Resolve a list of person tag inputs (existing id or new name) into person entity ids, auto-creating as needed. */
export function resolvePersonIds(db: AppDb, people: PersonTagInput[]): number[] {
  const ids = new Set<number>();
  for (const person of people) {
    if (person.id != null) {
      const entity = getEntityById(db, person.id);
      if (entity.category !== "person") {
        throw new BadRequestError(`Entity ${person.id} is not a person`);
      }
      ids.add(entity.id);
    } else if (person.name && person.name.trim()) {
      const entity = findOrCreateEntity(db, "person", person.name);
      ids.add(entity.id);
    }
  }
  return [...ids];
}

export function getPeopleForLogs(db: AppDb, logIds: number[]): Map<number, PersonRef[]> {
  const result = new Map<number, PersonRef[]>();
  if (logIds.length === 0) return result;

  const rows = db
    .select({
      logId: logPeople.logId,
      id: entities.id,
      name: entities.title,
    })
    .from(logPeople)
    .innerJoin(entities, eq(logPeople.personEntityId, entities.id))
    .where(inArray(logPeople.logId, logIds))
    .all();

  for (const row of rows) {
    const list = result.get(row.logId) ?? [];
    list.push({ id: row.id, name: row.name });
    result.set(row.logId, list);
  }
  return result;
}

/** Batch lookup mirroring getPeopleForLogs — albums a log is part of, grouped by logId. */
export function getAlbumsForLogs(db: AppDb, logIds: number[]): Map<number, AlbumRef[]> {
  const result = new Map<number, AlbumRef[]>();
  if (logIds.length === 0) return result;

  const rows = db
    .select({ logId: albumEvents.logId, id: albums.id, title: albums.title })
    .from(albumEvents)
    .innerJoin(albums, eq(albumEvents.albumId, albums.id))
    .where(inArray(albumEvents.logId, logIds))
    .all();

  for (const row of rows) {
    const list = result.get(row.logId) ?? [];
    list.push({ id: row.id, title: row.title });
    result.set(row.logId, list);
  }
  return result;
}

export function toLogDTO(
  row: typeof logs.$inferSelect,
  people: PersonRef[],
  photos: LogPhotoDTO[] = [],
  albumRefs: AlbumRef[] = [],
): LogDTO {
  return {
    id: row.id,
    entityId: row.entityId,
    rating: row.rating,
    date: row.date,
    notes: row.notes,
    people,
    photos,
    albums: albumRefs,
    autoDelete: row.autoDelete,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A LogDTO with its parent entity inlined. Used by search results, person appearances, album events. */
export function toLogWithEntity(
  row: typeof logs.$inferSelect,
  people: PersonRef[],
  entity: typeof entities.$inferSelect,
  photos: LogPhotoDTO[] = [],
  albumRefs: AlbumRef[] = [],
): LogWithEntityDTO {
  return {
    ...toLogDTO(row, people, photos, albumRefs),
    entity: toEntitySummary(entity),
  };
}

export function getLogsForEntity(db: AppDb, entityId: number): LogDTO[] {
  const rows = db.select().from(logs).where(eq(logs.entityId, entityId)).all();
  const logIds = rows.map((r) => r.id);
  const peopleByLog = getPeopleForLogs(db, logIds);
  const photosByLog = getPhotosForLogs(db, logIds);
  const albumsByLog = getAlbumsForLogs(db, logIds);
  return rows.map((row) =>
    toLogDTO(
      row,
      peopleByLog.get(row.id) ?? [],
      photosByLog.get(row.id) ?? [],
      albumsByLog.get(row.id) ?? [],
    ),
  );
}

export function getLogById(db: AppDb, id: number): LogDTO {
  const row = db.select().from(logs).where(eq(logs.id, id)).get();
  if (!row) {
    throw new NotFoundError(`Log ${id} not found`);
  }
  const peopleByLog = getPeopleForLogs(db, [id]);
  const photosByLog = getPhotosForLogs(db, [id]);
  const albumsByLog = getAlbumsForLogs(db, [id]);
  return toLogDTO(row, peopleByLog.get(id) ?? [], photosByLog.get(id) ?? [], albumsByLog.get(id) ?? []);
}

function validateRating(rating: number | null) {
  if (rating != null && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    throw new BadRequestError("Rating must be an integer between 1 and 5");
  }
}

export function createLog(db: AppDb, input: CreateLogRequest): LogDTO {
  validateRating(input.rating);

  let entityId: number;
  if (input.entityId != null) {
    const entity = getEntityById(db, input.entityId);
    if (!isLoggableCategory(entity.category)) {
      throw new BadRequestError(`Cannot log against a ${entity.category} entity`);
    }
    entityId = entity.id;
  } else if (input.category && input.title) {
    if (!isLoggableCategory(input.category)) {
      throw new BadRequestError(`${input.category} is not a loggable category`);
    }
    const entity = findOrCreateEntity(db, input.category, input.title, {
      releaseYear: input.releaseYear,
      author: input.author,
    });
    entityId = entity.id;
  } else {
    throw new BadRequestError("Either entityId or category+title is required");
  }

  const personIds = resolvePersonIds(db, input.people ?? []);

  const inserted = db
    .insert(logs)
    .values({
      entityId,
      rating: input.rating,
      date: input.date,
      notes: input.notes,
      autoDelete: input.autoDelete ?? false,
    })
    .returning()
    .get();

  if (personIds.length > 0) {
    db.insert(logPeople)
      .values(personIds.map((personEntityId) => ({ logId: inserted.id, personEntityId })))
      .run();
  }

  return toLogDTO(
    inserted,
    personIds.map((id) => {
      const entity = getEntityById(db, id);
      return { id: entity.id, name: entity.title };
    }),
  );
}

export function updateLog(db: AppDb, id: number, input: UpdateLogRequest): LogDTO {
  validateRating(input.rating);
  const existing = db.select().from(logs).where(eq(logs.id, id)).get();
  if (!existing) {
    throw new NotFoundError(`Log ${id} not found`);
  }

  const personIds = resolvePersonIds(db, input.people ?? []);

  const updated = db
    .update(logs)
    .set({
      rating: input.rating,
      date: input.date,
      notes: input.notes,
      autoDelete: input.autoDelete ?? false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(logs.id, id))
    .returning()
    .get();

  db.delete(logPeople).where(eq(logPeople.logId, id)).run();
  if (personIds.length > 0) {
    db.insert(logPeople)
      .values(personIds.map((personEntityId) => ({ logId: id, personEntityId })))
      .run();
  }

  return toLogDTO(
    updated,
    personIds.map((pid) => {
      const entity = getEntityById(db, pid);
      return { id: entity.id, name: entity.title };
    }),
  );
}

export function deleteLog(db: AppDb, id: number): void {
  const existing = db.select().from(logs).where(eq(logs.id, id)).get();
  if (!existing) {
    throw new NotFoundError(`Log ${id} not found`);
  }
  db.delete(logs).where(eq(logs.id, id)).run();
}
