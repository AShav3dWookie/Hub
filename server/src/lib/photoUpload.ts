import multer from "multer";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_LOG,
  MAX_PHOTOS_PER_ALBUM,
  ALLOWED_PHOTO_MIME_TYPES,
} from "../services/logPhotosService.js";
import { AppError, BadRequestError } from "./errors.js";

const MAX_FILES = Math.max(MAX_PHOTOS_PER_LOG, MAX_PHOTOS_PER_ALBUM);

/** Shared multer config for photo uploads (log photos + album loose photos). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_PHOTO_MIME_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new BadRequestError(`Unsupported image type: ${file.mimetype}`));
    }
  },
});

/** Translate multer / fileFilter errors into 400s the shared errorHandler understands. */
export function toClientError(err: unknown): Error {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return new BadRequestError("Each photo must be 10MB or smaller");
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return new BadRequestError("Too many photos in one upload");
    }
    return new BadRequestError(err.message);
  }
  if (err instanceof Error) return new BadRequestError(err.message);
  return new BadRequestError("Upload failed");
}
