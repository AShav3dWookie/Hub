import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entityNotes, entities } from "../db/schema.js";
import { bucketImportantDates, type UpcomingImportantDatesResponse } from "@logger/shared";

/**
 * All "important_date" notes, bucketed into ones landing today and ones landing within the
 * next 7 days, based on annual month+day recurrence.
 *
 * The recurrence maths, the window and the ordering live in `@logger/shared` so the offline
 * client's query layer reaches exactly the same answer from its local replica.
 */
export function getUpcomingImportantDates(
  db: AppDb,
  today: Date = new Date(),
): UpcomingImportantDatesResponse {
  const rows = db
    .select({
      noteId: entityNotes.id,
      entityId: entityNotes.entityId,
      entityName: entities.title,
      tag: entityNotes.tag,
      eventDate: entityNotes.eventDate,
      body: entityNotes.body,
    })
    .from(entityNotes)
    .innerJoin(entities, eq(entityNotes.entityId, entities.id))
    .where(eq(entityNotes.category, "important_date"))
    .all();

  return bucketImportantDates(rows, today);
}
