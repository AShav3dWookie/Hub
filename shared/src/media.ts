/**
 * Single source of truth for what can be uploaded as a photo/video attachment: the allowed
 * MIME types, per-type size caps, and the derived <input accept> string. Both the client
 * upload forms and the server upload pipeline import from here so they can never drift.
 *
 * Videos are mp4-only on purpose: an uploaded file is played back as-is (no transcoding), and
 * mp4/H.264 is the only container+codec that plays in every browser we care about. `.mov`
 * (usually HEVC) and `.webm` are rejected at upload with a clear message.
 */

export type MediaKind = "photo" | "video";

/** Allowed image upload MIME types → on-disk extension for the stored original. */
export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Allowed video upload MIME types → on-disk extension. mp4 only (see file header). */
export const ALLOWED_VIDEO_MIME_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
};

/** Every allowed media MIME type → on-disk extension. */
export const ALLOWED_MEDIA_MIME_TYPES: Record<string, string> = {
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES,
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // 250 MB

/** Bound the in-RAM spike from multer's memoryStorage on a single upload request. */
export const MAX_VIDEOS_PER_UPLOAD = 10;
export const MAX_UPLOAD_BATCH_BYTES = 900 * 1024 * 1024; // ~900 MB across all files in one request

/** Whether this MIME type is an allowed upload at all. */
export function isAllowedMediaMime(mime: string): boolean {
  return mime in ALLOWED_MEDIA_MIME_TYPES;
}

/**
 * Classify a MIME type as a photo or a video. Unknown types fall back to "photo" — every
 * legacy `log_photos` row is an image, and callers that care about rejection check
 * `isAllowedMediaMime` separately.
 */
export function mediaKindForMime(mime: string): MediaKind {
  return mime in ALLOWED_VIDEO_MIME_TYPES ? "video" : "photo";
}

/** On-disk extension for a stored original, or undefined if the type isn't allowed. */
export function extForMime(mime: string): string | undefined {
  return ALLOWED_MEDIA_MIME_TYPES[mime];
}

/** The per-file byte cap that applies to this MIME type. */
export function maxBytesForMime(mime: string): number {
  return mediaKindForMime(mime) === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** Value for a file <input accept> attribute covering every allowed media type. */
export const MEDIA_ACCEPT_ATTR = Object.keys(ALLOWED_MEDIA_MIME_TYPES).join(",");
