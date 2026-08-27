import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { listGalleryPhotos } from "../services/galleryService.js";
import { deletePhotoById } from "../services/logPhotosService.js";
import { galleryQuerySchema } from "../lib/validation.js";
import { BadRequestError } from "../lib/errors.js";

export function createGalleryRouter(db: AppDb, photosDir: string = config.photosDir): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { cursor, limit } = galleryQuerySchema.parse(req.query);
    res.json(listGalleryPhotos(db, { cursor, limit }));
  });

  router.delete("/:photoId", (req, res) => {
    const photoId = Number(req.params.photoId);
    if (!Number.isInteger(photoId)) {
      throw new BadRequestError("Invalid photo id");
    }
    deletePhotoById(db, photosDir, photoId);
    res.status(204).send();
  });

  return router;
}
