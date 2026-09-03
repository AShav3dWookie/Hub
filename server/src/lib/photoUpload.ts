import type { RequestHandler } from "express";
import multer from "multer";
import {
  MAX_UPLOAD_BATCH_BYTES,
  MAX_VIDEO_BYTES,
  isAllowedMediaMime,
} from "@logger/shared";
import { MAX_PHOTOS_PER_LOG, MAX_PHOTOS_PER_ALBUM } from "../services/logPhotosService.js";
import { AppError, BadRequestError } from "./errors.js";

const MAX_FILES = Math.max(MAX_PHOTOS_PER_LOG, MAX_PHOTOS_PER_ALBUM);

/** Shared multer config for media uploads (log photos/videos + album loose photos/videos). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMediaMime(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

/**
 * Reject an oversize upload from its `Content-Length` alone, before multer buffers a single
 * byte into memory. A generous slop is added over the batch budget for multipart overhead;
 * the exact per-file and per-batch limits are still enforced in the service.
 */
export const rejectOversizeUpload: RequestHandler = (req, _res, next) => {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BATCH_BYTES + 16 * 1024 * 1024) {
    next(new BadRequestError("That upload is too large — send fewer or smaller files"));
    return;
  }
  next();
};

/** Translate multer / fileFilter errors into 400s the shared errorHandler understands. */
export function toClientError(err: unknown): Error {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return new BadRequestError("That file is too large (250MB max)");
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return new BadRequestError("Too many files in one upload");
    }
    return new BadRequestError(err.message);
  }
  if (err instanceof Error) return new BadRequestError(err.message);
  return new BadRequestError("Upload failed");
}
