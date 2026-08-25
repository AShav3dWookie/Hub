import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople } from "../db/schema.js";
import { getEntityById, toEntitySummary } from "./entityService.js";
import { getLogsForEntity } from "./logService.js";
import { BadRequestError } from "../lib/errors.js";
import type {
  EntityWithLogsDTO,
  PersonProfileDTO,
  LogWithEntityDTO,
  PersonStats,
  PersonRef,
  LoggableCategory,
} from "@logger/shared";

export function getEntityWithLogs(db: AppDb, id: number): EntityWithLogsDTO {
  const entity = getEntityById(db, id);
  if (entity.category === "person") {
    throw new BadRequestError("Use the person profile endpoint for person entities");
  }
  const entityLogs = getLogsForEntity(db, id).sort((a, b) => b.date.localeCompare(a.date));

  const ratedLogs = entityLogs.filter((l) => l.rating != null);
  const averageRating =
    ratedLogs.length > 0
      ? ratedLogs.reduce((sum, l) => sum + (l.rating ?? 0), 0) / ratedLogs.length
      : null;
  const latestDate = entityLogs.length > 0 ? entityLogs[0].date : null;

  return {
    ...toEntitySummary(entity),
    logs: entityLogs,
    visitCount: entityLogs.length,
    averageRating,
    latestDate,
  };
}

export function getPersonProfile(db: AppDb, id: number): PersonProfileDTO {
  const entity = getEntityById(db, id);
  if (entity.category !== "person") {
    throw new BadRequestError("Entity is not a person");
  }

  const logIds = db
    .select({ logId: logPeople.logId })
    .from(logPeople)
    .where(eq(logPeople.personEntityId, id))
    .all()
    .map((r) => r.logId);

  let appearances: LogWithEntityDTO[] = [];
  if (logIds.length > 0) {
    const logRows = db.select().from(logs).where(inArray(logs.id, logIds)).all();
    const entityIds = [...new Set(logRows.map((l) => l.entityId))];
    const entityRows = db.select().from(entities).where(inArray(entities.id, entityIds)).all();
    const entityById = new Map(entityRows.map((e) => [e.id, e]));

    const peopleRows = db
      .select({ logId: logPeople.logId, id: entities.id, name: entities.title })
      .from(logPeople)
      .innerJoin(entities, eq(logPeople.personEntityId, entities.id))
      .where(inArray(logPeople.logId, logIds))
      .all();
    const peopleByLog = new Map<number, PersonRef[]>();
    for (const row of peopleRows) {
      const list = peopleByLog.get(row.logId) ?? [];
      list.push({ id: row.id, name: row.name });
      peopleByLog.set(row.logId, list);
    }

    appearances = logRows
      .map((row) => {
        const parentEntity = entityById.get(row.entityId);
        if (!parentEntity) return null;
        return {
          id: row.id,
          entityId: row.entityId,
          rating: row.rating,
          date: row.date,
          notes: row.notes,
          people: peopleByLog.get(row.id) ?? [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          entity: toEntitySummary(parentEntity),
        } satisfies LogWithEntityDTO;
      })
      .filter((x): x is LogWithEntityDTO => x !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  const stats = computePersonStats(db, id, appearances);

  return {
    entity: toEntitySummary(entity),
    appearances,
    stats,
  };
}

function computePersonStats(
  db: AppDb,
  personId: number,
  appearances: LogWithEntityDTO[],
): PersonStats {
  const totalLogs = appearances.length;

  const categoryCounts = new Map<LoggableCategory, number>();
  for (const log of appearances) {
    if (log.entity.category === "person") continue;
    const category = log.entity.category as LoggableCategory;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  let favoriteCategory: LoggableCategory | null = null;
  let maxCount = 0;
  for (const [category, count] of categoryCounts) {
    if (count > maxCount) {
      maxCount = count;
      favoriteCategory = category;
    }
  }

  let mostFrequentCoPerson: PersonRef | null = null;
  if (appearances.length > 0) {
    const logIds = appearances.map((a) => a.id);
    const coPersonRows = db
      .select({ id: entities.id, name: entities.title })
      .from(logPeople)
      .innerJoin(entities, eq(logPeople.personEntityId, entities.id))
      .where(inArray(logPeople.logId, logIds))
      .all();

    const coCounts = new Map<number, { name: string; count: number }>();
    for (const row of coPersonRows) {
      if (row.id === personId) continue;
      const existing = coCounts.get(row.id);
      coCounts.set(row.id, { name: row.name, count: (existing?.count ?? 0) + 1 });
    }
    let maxCoCount = 0;
    for (const [id, { name, count }] of coCounts) {
      if (count > maxCoCount) {
        maxCoCount = count;
        mostFrequentCoPerson = { id, name };
      }
    }
  }

  return { totalLogs, favoriteCategory, mostFrequentCoPerson };
}
