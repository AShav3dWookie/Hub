import { eq, lt } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entityNotes, entities, logPeople, logs, voiceCommands } from "../db/schema.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import { deleteListItem } from "./listService.js";
import { deleteLog } from "./logService.js";
import { VOICE_UNDO_WINDOW_MS, type VoiceActionName, type VoiceRecord } from "@logger/shared";

/** Long enough for any Undo to have been tapped; the table is a short-lived log, not history. */
export const VOICE_COMMAND_RETENTION_MS = 24 * 60 * 60_000;

/** Note what a voice command created, for Undo. Returns the command's id. */
export function recordVoiceCommand(
  db: AppDb,
  { action, created, deviceId, now }: { action: VoiceActionName; created: VoiceRecord[]; deviceId: number | null; now: Date },
): number {
  db.delete(voiceCommands)
    .where(lt(voiceCommands.createdAt, new Date(now.getTime() - VOICE_COMMAND_RETENTION_MS).toISOString()))
    .run();
  return db
    .insert(voiceCommands)
    .values({ action, created, deviceTokenId: deviceId, createdAt: now.toISOString() })
    .returning({ id: voiceCommands.id })
    .get().id;
}

/** Already gone (deleted in the browser meanwhile) counts as undone. */
function ignoreMissing(remove: () => void) {
  try {
    remove();
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
}

/** An entity the command made goes too, unless something has been added to it since. */
function removeEntityIfUnused(db: AppDb, id: number) {
  const used =
    db.select({ id: logs.id }).from(logs).where(eq(logs.entityId, id)).get() ??
    db.select({ id: entityNotes.id }).from(entityNotes).where(eq(entityNotes.entityId, id)).get() ??
    db.select({ id: logPeople.logId }).from(logPeople).where(eq(logPeople.personEntityId, id)).get();
  if (!used) db.delete(entities).where(eq(entities.id, id)).run();
}

/**
 * Take away exactly what voice command `id` created. Only the device that said it may (`deviceId`
 * null is a signed-in browser, which may undo only its own), and only within
 * `VOICE_UNDO_WINDOW_MS`, judged by the hub's clock, so a tap queued with no signal is still
 * refused once it reaches the hub too late. A second undo is a no-op.
 */
export function undoVoiceCommand(db: AppDb, id: number, deviceId: number | null, now: Date): void {
  const command = db.select().from(voiceCommands).where(eq(voiceCommands.id, id)).get();
  // Someone else's command is reported exactly like one that doesn't exist.
  if (!command || command.deviceTokenId !== deviceId) throw new NotFoundError(`No voice command ${id} to undo`);
  if (command.undoneAt) return;
  if (now.getTime() - Date.parse(command.createdAt) > VOICE_UNDO_WINDOW_MS) {
    throw new AppError(410, `Too late to undo: that was more than ${VOICE_UNDO_WINDOW_MS / 60_000} minutes ago`);
  }

  db.transaction(() => {
    // Newest first: a log goes before the entity it was filed under.
    for (const record of [...command.created].reverse()) {
      if (record.kind === "listItem") ignoreMissing(() => deleteListItem(db, record.listId, record.id));
      else if (record.kind === "log") ignoreMissing(() => deleteLog(db, record.id));
      else removeEntityIfUnused(db, record.id);
    }
    db.update(voiceCommands)
      .set({ undoneAt: now.toISOString() })
      .where(eq(voiceCommands.id, id))
      .run();
  });
}
