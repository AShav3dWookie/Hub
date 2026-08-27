import { Router } from "express";
import multer from "multer";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import {
  createLogPhotos,
  deleteLogPhoto,
  MAX_PHOTOS_PER_LOG,
  MAX_PHOTO_BYTES,
  ALLOWED_PHOTO_MIME_TYPES,
} from "../services/logPhotosService.js";
import { AppError, BadRequestError } from "../lib/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_LOG },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_PHOTO_MIME_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new BadRequestError(`Unsupported image type: ${file.mimetype}`));
    }
  },
});

/** Translate multer / fileFilter errors into 400s the shared errorHandler understands. */
function toClientError(err: unknown): Error {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return new BadRequestError("Each photo must be 10MB or smaller");
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return new BadRequestError(`A log can have at most ${MAX_PHOTOS_PER_LOG} photos`);
    }
    return new BadRequestError(err.message);
  }
  if (err instanceof Error) return new BadRequestError(err.message);
  return new BadRequestError("Upload failed");
}

function parseLogId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new BadRequestError("Invalid log id");
  }
  return id;
}

export function createLogPhotosRouter(db: AppDb, photosDir: string = config.photosDir): Router {
  const router = Router();

  router.post("/:logId/photos", (req, res, next) => {
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
