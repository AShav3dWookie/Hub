import { PlayCircle } from "lucide-react";
import type { LogPhotoDTO } from "@logger/shared";

/**
 * A thumbnail with a play badge over it when the item is a video.
 *
 * Both photo grids render this. A video's stored thumbnail is a poster frame, so the badge is
 * the only thing distinguishing it from a still.
 */
export function MediaThumb({
  photo,
  badgeSize = "h-7 w-7",
}: {
  photo: Pick<LogPhotoDTO, "kind" | "thumbnailUrl" | "originalName">;
  /** Tailwind sizing for the play icon; the two grids use slightly different tiles. */
  badgeSize?: string;
}) {
  return (
    <>
      <img
        src={photo.thumbnailUrl}
        alt={photo.originalName}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {photo.kind === "video" && (
        <span
          data-testid="video-badge"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <PlayCircle className={`${badgeSize} text-white drop-shadow`} strokeWidth={1.5} />
        </span>
      )}
    </>
  );
}

/**
 * The full-size source for a lightbox neighbour: a video has no still to preload, so its poster
 * frame stands in.
 */
export function neighbourSrc(
  photo: Pick<LogPhotoDTO, "kind" | "url" | "thumbnailUrl"> | undefined,
): string | undefined {
  if (!photo) return undefined;
  return photo.kind === "video" ? photo.thumbnailUrl : photo.url;
}
