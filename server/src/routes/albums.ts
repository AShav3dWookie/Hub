import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import {
  getAlbumById,
  listAlbums,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  addAlbumEvent,
  removeAlbumEvent,
  addAlbumPerson,
  removeAlbumPerson,
} from "../services/albumService.js";
import { createAlbumPhotos, deleteAlbumPhoto } from "../services/albumPhotosService.js";
import { deletePhotosForAlbum, MAX_PHOTOS_PER_ALBUM } from "../services/logPhotosService.js";
import { listGalleryPhotos } from "../services/galleryService.js";
import {
  createAlbumSchema,
  updateAlbumSchema,
  albumEventSchema,
  personTagSchema,
  galleryQuerySchema,
} from "../lib/validation.js";
import { upload, toClientError } from "../lib/photoUpload.js";
import { BadRequestError } from "../lib/errors.js";

function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return id;
}

export function createAlbumsRouter(db: AppDb, photosDir: string = config.photosDir): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(listAlbums(db));
  });

  router.post("/", (req, res) => {
    const input = createAlbumSchema.parse(req.body);
    res.status(201).json(createAlbum(db, input));
  });

  router.get("/:id", (req, res) => {
    res.json(getAlbumById(db, parseId(req.params.id, "album id")));
  });

  router.put("/:id", (req, res) => {
    const input = updateAlbumSchema.parse(req.body);
    res.json(updateAlbum(db, parseId(req.params.id, "album id"), input));
  });

  router.delete("/:id", (req, res) => {
    const id = parseId(req.params.id, "album id");
    // Loose photos are kept as gallery orphans (FK ON DELETE SET NULL) unless ?deletePhotos=true.
    if (req.query.deletePhotos === "true") {
      deletePhotosForAlbum(db, photosDir, id);
    }
    deleteAlbum(db, id);
    res.status(204).send();
  });

  router.post("/:id/events", (req, res) => {
    const { logId } = albumEventSchema.parse(req.body);
    res.status(201).json(addAlbumEvent(db, parseId(req.params.id, "album id"), logId));
  });

  router.delete("/:id/events/:logId", (req, res) => {
    removeAlbumEvent(
      db,
      parseId(req.params.id, "album id"),
      parseId(req.params.logId, "log id"),
    );
    res.status(204).send();
  });

  router.post("/:id/people", (req, res) => {
    const person = personTagSchema.parse(req.body);
    res.status(200).json(addAlbumPerson(db, parseId(req.params.id, "album id"), person));
  });

  router.delete("/:id/people/:personId", (req, res) => {
    removeAlbumPerson(
      db,
      parseId(req.params.id, "album id"),
      parseId(req.params.personId, "person id"),
    );
    res.status(204).send();
  });

  router.get("/:id/photos", (req, res) => {
    const id = parseId(req.params.id, "album id");
    const { cursor, limit } = galleryQuerySchema.parse(req.query);
    res.json(listGalleryPhotos(db, { albumId: id, cursor, limit }));
  });

  router.post("/:id/photos", (req, res, next) => {
    upload.array("photos", MAX_PHOTOS_PER_ALBUM)(req, res, (uploadErr) => {
      if (uploadErr) {
        next(toClientError(uploadErr));
        return;
      }
      let id: number;
      try {
        id = parseId(req.params.id, "album id");
      } catch (err) {
        next(err);
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      createAlbumPhotos(db, photosDir, id, files)
        .then((photos) => res.status(201).json(photos))
        .catch(next);
    });
  });

  router.delete("/:id/photos/:photoId", (req, res) => {
    deleteAlbumPhoto(
      db,
      photosDir,
      parseId(req.params.id, "album id"),
      parseId(req.params.photoId, "photo id"),
    );
    res.status(204).send();
  });

  return router;
}
