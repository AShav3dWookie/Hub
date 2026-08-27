import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db/client.js";
import {
  createBareEntity,
  searchEntitiesByTitle,
  getEntityById,
} from "../services/entityService.js";
import { getEntityWithLogs, getPersonProfile } from "../services/entityDetailService.js";
import {
  listEntityNotes,
  createEntityNote,
  updateEntityNote,
  deleteEntityNote,
} from "../services/entityNotesService.js";
import { listGalleryPhotos } from "../services/galleryService.js";
import {
  createEntitySchema,
  categorySchema,
  createEntityNoteSchema,
  updateEntityNoteSchema,
  galleryQuerySchema,
} from "../lib/validation.js";
import { BadRequestError } from "../lib/errors.js";

export function createEntitiesRouter(db: AppDb): Router {
  const router = Router();

  router.get("/search", (req, res) => {
    const querySchema = z.object({
      category: categorySchema,
      q: z.string().optional().default(""),
    });
    const { category, q } = querySchema.parse(req.query);
    const results = searchEntitiesByTitle(db, category, q);
    res.json(results);
  });

  router.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid entity id");
    }
    const entity = getEntityById(db, id);
    if (entity.category === "person") {
      res.json({ type: "person" as const, ...getPersonProfile(db, id) });
      return;
    }
    res.json({ type: "entity" as const, ...getEntityWithLogs(db, id) });
  });

  router.post("/", (req, res) => {
    const { category, title, releaseYear, author } = createEntitySchema.parse(req.body);
    const entity = createBareEntity(db, category, title, { releaseYear, author });
    res.status(201).json(entity);
  });

  router.get("/:id/notes", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid entity id");
    }
    res.json(listEntityNotes(db, id));
  });

  // Every photo from an event this person is tagged in (see galleryService personId filter).
  router.get("/:id/photos", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid entity id");
    }
    const entity = getEntityById(db, id);
    if (entity.category !== "person") {
      throw new BadRequestError("Entity is not a person");
    }
    const { cursor, limit } = galleryQuerySchema.parse(req.query);
    res.json(listGalleryPhotos(db, { personId: id, cursor, limit }));
  });

  router.post("/:id/notes", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid entity id");
    }
    const input = createEntityNoteSchema.parse(req.body);
    const note = createEntityNote(db, id, input);
    res.status(201).json(note);
  });

  router.put("/:id/notes/:noteId", (req, res) => {
    const noteId = Number(req.params.noteId);
    if (!Number.isInteger(noteId)) {
      throw new BadRequestError("Invalid note id");
    }
    const input = updateEntityNoteSchema.parse(req.body);
    const note = updateEntityNote(db, noteId, input);
    res.json(note);
  });

  router.delete("/:id/notes/:noteId", (req, res) => {
    const noteId = Number(req.params.noteId);
    if (!Number.isInteger(noteId)) {
      throw new BadRequestError("Invalid note id");
    }
    deleteEntityNote(db, noteId);
    res.status(204).send();
  });

  return router;
}
