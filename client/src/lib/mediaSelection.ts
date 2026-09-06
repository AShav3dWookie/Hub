import { isAllowedMediaMime, maxBytesForMime, mediaKindForMime } from "@logger/shared";

/**
 * Client-side checks on a picked file list, so an upload that the server would reject is
 * refused with a plain message before anything is sent.
 *
 * The server enforces all of this again — this is a courtesy, not the boundary. The limits
 * themselves come from `@logger/shared`, so they cannot drift from what the server allows.
 */

/** Photos or videos attached to a single log. The server enforces the same cap. */
export const MAX_MEDIA_PER_LOG = 10;

/**
 * Why a selection cannot be uploaded, phrased for a toast, or null when it is fine.
 * `existingCount` is what the record already holds, so the cap covers the total.
 */
export function rejectMediaSelection(
  files: readonly File[],
  options: { existingCount?: number; max?: number; subject?: string } = {},
): string | null {
  const { existingCount = 0, max = MAX_MEDIA_PER_LOG, subject = "A log" } = options;

  if (files.length === 0) return null;

  if (existingCount + files.length > max) {
    return `${subject} can have at most ${max} photos or videos`;
  }

  if (files.some((f) => !isAllowedMediaMime(f.type))) {
    return "Only images and mp4 videos can be uploaded";
  }

  const tooBig = files.find((f) => f.size > maxBytesForMime(f.type));
  if (tooBig) {
    return mediaKindForMime(tooBig.type) === "video"
      ? "Videos must be 250MB or smaller"
      : "Photos must be 10MB or smaller";
  }

  return null;
}
