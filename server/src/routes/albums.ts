import { Router } from "express";
import { idParam } from "../lib/params.js";
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
import { upload, rejectOversizeUpload, toClientError } from "../middleware/upload.js";

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
    res.json(getAlbumById(db, idParam(req, "id", "album id")));
  });

  router.put("/:id", (req, res) => {
    const input = updateAlbumSchema.parse(req.body);
    res.json(updateAlbum(db, idParam(req, "id", "album id"), input));
  });

  router.delete("/:id", (req, res) => {
    const id = idParam(req, "id", "album id");
    // Loose photos are kept as gallery orphans (FK ON DELETE SET NULL) unless ?deletePhotos=true.
    if (req.query.deletePhotos === "true") {
      deletePhotosForAlbum(db, photosDir, id);
    }
    deleteAlbum(db, id);
    res.status(204).send();
  });

  router.post("/:id/events", (req, res) => {
    const { logId } = albumEventSchema.parse(req.body);
    res.status(201).json(addAlbumEvent(db, idParam(req, "id", "album id"), logId));
  });

  router.delete("/:id/events/:logId", (req, res) => {
    removeAlbumEvent(
      db,
      idParam(req, "id", "album id"),
      idParam(req, "logId", "log id"),
    );
    res.status(204).send();
  });

  router.post("/:id/people", (req, res) => {
    const person = personTagSchema.parse(req.body);
    res.status(200).json(addAlbumPerson(db, idParam(req, "id", "album id"), person));
  });

  router.delete("/:id/people/:personId", (req, res) => {
    removeAlbumPerson(
      db,
      idParam(req, "id", "album id"),
      idParam(req, "personId", "person id"),
    );
    res.status(204).send();
  });

  router.get("/:id/photos", (req, res) => {
    const id = idParam(req, "id", "album id");
    const { cursor, limit } = galleryQuerySchema.parse(req.query);
    res.json(listGalleryPhotos(db, { albumId: id, cursor, limit }));
  });

  router.post("/:id/photos", rejectOversizeUpload, (req, res, next) => {
    upload.array("photos", MAX_PHOTOS_PER_ALBUM)(req, res, (uploadErr) => {
      if (uploadErr) {
        next(toClientError(uploadErr));
        return;
      }
      let id: number;
      try {
        id = idParam(req, "id", "album id");
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
      idParam(req, "id", "album id"),
      idParam(req, "photoId", "photo id"),
    );
    res.status(204).send();
  });

  return router;
}
