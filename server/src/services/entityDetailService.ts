import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople } from "../db/schema.js";
import { getEntityById, toEntitySummary } from "./entityService.js";
import { getLogsForEntity, toLogWithEntity } from "./logService.js";
import { BadRequestError } from "../lib/errors.js";
import { computePersonStats } from "@logger/shared";
import type {
  EntityWithLogsDTO,
  PersonProfileDTO,
  LogWithEntityDTO,
  PersonRef,
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

    // Person-profile appearances are a summary list, like search results, not a detail view.
    // `toLogWithEntity` defaults photos and album refs to [], which is exactly what is wanted
    // here: no per-log photo lookup is triggered.
    appearances = logRows
      .map((row) => {
        const parentEntity = entityById.get(row.entityId);
        if (!parentEntity) return null;
        return toLogWithEntity(row, peopleByLog.get(row.id) ?? [], parentEntity);
      })
      .filter((x): x is LogWithEntityDTO => x !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  return {
    entity: toEntitySummary(entity),
    appearances,
    stats: computePersonStats(id, appearances),
  };
}
