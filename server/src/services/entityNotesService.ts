import { eq, desc } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entityNotes } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { getEntityById } from "./entityService.js";
import type { EntityNoteDTO, CreateEntityNoteRequest, UpdateEntityNoteRequest } from "@logger/shared";

export function toEntityNoteDTO(row: typeof entityNotes.$inferSelect): EntityNoteDTO {
  return {
    id: row.id,
    entityId: row.entityId,
    category: row.category as EntityNoteDTO["category"],
    body: row.body,
    tag: row.tag,
    eventDate: row.eventDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listEntityNotes(db: AppDb, entityId: number): EntityNoteDTO[] {
  getEntityById(db, entityId);
  const rows = db
    .select()
    .from(entityNotes)
    .where(eq(entityNotes.entityId, entityId))
    .orderBy(desc(entityNotes.createdAt), desc(entityNotes.id))
    .all();
  return rows.map(toEntityNoteDTO);
}

export function createEntityNote(
  db: AppDb,
  entityId: number,
  input: CreateEntityNoteRequest,
): EntityNoteDTO {
  getEntityById(db, entityId);
  const inserted = db
    .insert(entityNotes)
    .values({
      entityId,
      category: input.category ?? "general",
      body: input.body,
      tag: input.tag ?? null,
      eventDate: input.eventDate ?? null,
    })
    .returning()
    .get();
  return toEntityNoteDTO(inserted);
}

export function updateEntityNote(
  db: AppDb,
  noteId: number,
  input: UpdateEntityNoteRequest,
): EntityNoteDTO {
  const existing = db.select().from(entityNotes).where(eq(entityNotes.id, noteId)).get();
  if (!existing) {
    throw new NotFoundError(`Note ${noteId} not found`);
  }
  const updated = db
    .update(entityNotes)
    .set({
      category: input.category ?? existing.category,
      body: input.body,
      tag: input.tag ?? null,
      eventDate: input.eventDate ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(entityNotes.id, noteId))
    .returning()
    .get();
  return toEntityNoteDTO(updated);
}

export function deleteEntityNote(db: AppDb, noteId: number): void {
  const existing = db.select().from(entityNotes).where(eq(entityNotes.id, noteId)).get();
  if (!existing) {
    throw new NotFoundError(`Note ${noteId} not found`);
  }
  db.delete(entityNotes).where(eq(entityNotes.id, noteId)).run();
}
