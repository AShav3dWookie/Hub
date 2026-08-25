import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople } from "../db/schema.js";
import { findOrCreateEntity, getEntityById } from "./entityService.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import type {
  CreateLogRequest,
  UpdateLogRequest,
  LogDTO,
  PersonRef,
  PersonTagInput,
} from "@logger/shared";
import { isLoggableCategory } from "@logger/shared";

/** Resolve a list of person tag inputs (existing id or new name) into person entity ids, auto-creating as needed. */
function resolvePersonIds(db: AppDb, people: PersonTagInput[]): number[] {
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

function getPeopleForLogs(db: AppDb, logIds: number[]): Map<number, PersonRef[]> {
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

export function toLogDTO(row: typeof logs.$inferSelect, people: PersonRef[]): LogDTO {
  return {
    id: row.id,
    entityId: row.entityId,
    rating: row.rating,
    date: row.date,
    notes: row.notes,
    people,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getLogsForEntity(db: AppDb, entityId: number): LogDTO[] {
  const rows = db.select().from(logs).where(eq(logs.entityId, entityId)).all();
  const peopleByLog = getPeopleForLogs(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toLogDTO(row, peopleByLog.get(row.id) ?? []));
}

export function getLogById(db: AppDb, id: number): LogDTO {
  const row = db.select().from(logs).where(eq(logs.id, id)).get();
  if (!row) {
    throw new NotFoundError(`Log ${id} not found`);
  }
  const peopleByLog = getPeopleForLogs(db, [id]);
  return toLogDTO(row, peopleByLog.get(id) ?? []);
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
    const entity = findOrCreateEntity(db, input.category, input.title);
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
