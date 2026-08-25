import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import { entities } from "../db/schema.js";
import { findOrCreateEntity } from "./entityService.js";
import {
  listEntityNotes,
  createEntityNote,
  updateEntityNote,
  deleteEntityNote,
} from "./entityNotesService.js";
import { NotFoundError } from "../lib/errors.js";

describe("entityNotesService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("creates a note defaulting to the 'general' category", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");

    const note = createEntityNote(ctx.db, sarah.id, { body: "Loves hiking" });

    expect(note.category).toBe("general");
    expect(note.body).toBe("Loves hiking");
    expect(note.entityId).toBe(sarah.id);
  });

  it("lists notes for an entity, newest first", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    createEntityNote(ctx.db, sarah.id, { category: "gift_idea", body: "Vinyl record" });
    createEntityNote(ctx.db, sarah.id, { category: "conversation_topic", body: "New job" });

    const notes = listEntityNotes(ctx.db, sarah.id);
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toBe("New job");
    expect(notes[1].body).toBe("Vinyl record");
  });

  it("updates a note's category and body", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    const note = createEntityNote(ctx.db, sarah.id, { body: "Draft" });

    const updated = updateEntityNote(ctx.db, note.id, {
      category: "gift_idea",
      body: "Concert tickets",
    });

    expect(updated.category).toBe("gift_idea");
    expect(updated.body).toBe("Concert tickets");
  });

  it("deletes a note", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    const note = createEntityNote(ctx.db, sarah.id, { body: "Temporary" });

    deleteEntityNote(ctx.db, note.id);

    expect(listEntityNotes(ctx.db, sarah.id)).toHaveLength(0);
  });

  it("throws NotFoundError when updating or deleting a nonexistent note", () => {
    ctx = createTestDb();
    expect(() => updateEntityNote(ctx.db, 999, { body: "x" })).toThrow(NotFoundError);
    expect(() => deleteEntityNote(ctx.db, 999)).toThrow(NotFoundError);
  });

  it("cascades deletion of notes when the parent entity is deleted", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    createEntityNote(ctx.db, sarah.id, { body: "Will be cascaded" });

    ctx.db.delete(entities).where(eq(entities.id, sarah.id)).run();

    expect(() => listEntityNotes(ctx.db, sarah.id)).toThrow();
  });
});
