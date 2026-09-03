import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { createLogPhotos, deleteLogPhoto, MAX_PHOTOS_PER_LOG } from "../services/logPhotosService.js";
import { upload, rejectOversizeUpload, toClientError } from "../lib/photoUpload.js";
import { BadRequestError } from "../lib/errors.js";

function parseLogId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new BadRequestError("Invalid log id");
  }
  return id;
}

export function createLogPhotosRouter(db: AppDb, photosDir: string = config.photosDir): Router {
  const router = Router();

  router.post("/:logId/photos", rejectOversizeUpload, (req, res, next) => {
    upload.array("photos", MAX_PHOTOS_PER_LOG)(req, res, (uploadErr) => {
      if (uploadErr) {
        next(toClientError(uploadErr));
        return;
      }
      let logId: number;
      try {
        logId = parseLogId(req.params.logId);
      } catch (err) {
        next(err);
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      createLogPhotos(db, photosDir, logId, files)
        .then((photos) => res.status(201).json(photos))
        .catch(next);
    });
  });

  router.delete("/:logId/photos/:photoId", (req, res) => {
    const logId = parseLogId(req.params.logId);
    const photoId = Number(req.params.photoId);
    if (!Number.isInteger(photoId)) {
      throw new BadRequestError("Invalid photo id");
    }
    deleteLogPhoto(db, photosDir, logId, photoId);
    res.status(204).send();
  });

  return router;
}
