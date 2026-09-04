import { useRef, useState } from "react";
import { SECONDARY_BUTTON_SM_CLASS, DANGER_BUTTON_CLASS } from "./ui.js";
import { X } from "lucide-react";
import { MEDIA_ACCEPT_ATTR, type LogPhotoDTO } from "@logger/shared";
import { useUploadLogPhotos, useDeleteLogPhoto } from "../api/hooks.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { Lightbox } from "./Lightbox.js";
import { MediaThumb, neighbourSrc } from "./MediaThumb.js";
import { useToast } from "./ToastProvider.js";
import { MAX_MEDIA_PER_LOG, rejectMediaSelection } from "../lib/mediaSelection.js";

const MAX_PHOTOS = MAX_MEDIA_PER_LOG;

export function PhotoGallery({
  logId,
  photos,
  allowDelete = false,
}: {
  logId: number;
  photos: LogPhotoDTO[];
  /** Show the per-photo delete control. Off in the read-only strip, on in the event editor. */
  allowDelete?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const lightbox = lightboxIndex == null ? null : photos[lightboxIndex] ?? null;

  const upload = useUploadLogPhotos(logId);
  const deletePhoto = useDeleteLogPhoto(logId);
  const { showToast } = useToast();
  const online = useOnlineStatus();

  // Photos go straight to the server (no offline queue): only possible online, and only once
  // the entry itself has a real server id (a freshly-created offline entry has a temp one).
  const canEditPhotos = online && logId > 0;
  const atLimit = photos.length >= MAX_PHOTOS;

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const problem = rejectMediaSelection(files, { existingCount: photos.length });
    if (problem) {
      showToast(problem);
      return;
    }
    try {
      await upload.mutateAsync(files);
      showToast(files.length === 1 ? "Added" : `${files.length} added`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function handleDelete(photoId: number) {
    try {
      await deletePhoto.mutateAsync(photoId);
      setConfirmingDelete(null);
      showToast("Photo deleted");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete photo");
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, i) => (
          <div key={photo.id} className="relative">
            <button
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="block h-20 w-20 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
            >
              <MediaThumb photo={photo} />
            </button>
            {allowDelete && canEditPhotos && (
              <button
                type="button"
                aria-label={`Delete ${photo.originalName}`}
                onClick={() => setConfirmingDelete(photo.id)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900/80 p-1 text-white hover:bg-red-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}

        {!atLimit && canEditPhotos && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 px-1 text-center text-xs text-slate-500 hover:border-slate-400 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400"
          >
            {upload.isPending ? "Uploading…" : "Add photos"}
          </button>
        )}
      </div>

      {!canEditPhotos && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {logId < 0
            ? "Photos can be added once this entry has synced."
            : "Reconnect to add or remove photos."}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={MEDIA_ACCEPT_ATTR}
        multiple
        onChange={handleFiles}
        className="hidden"
        data-testid="photo-file-input"
      />

      {allowDelete && confirmingDelete != null && (
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Delete this photo?</span>
          <button
            type="button"
            onClick={() => handleDelete(confirmingDelete)}
            className={DANGER_BUTTON_CLASS}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(null)}
            className={SECONDARY_BUTTON_SM_CLASS}
          >
            Cancel
          </button>
        </div>
      )}

      {lightbox && lightboxIndex != null && (
        <Lightbox
          src={lightbox.url}
          alt={lightbox.originalName}
          kind={lightbox.kind}
          poster={lightbox.thumbnailUrl}
          prevSrc={neighbourSrc(photos[lightboxIndex - 1])}
          nextSrc={neighbourSrc(photos[lightboxIndex + 1])}
          onClose={() => setLightboxIndex(null)}
          onPrev={
            lightboxIndex > 0 ? () => setLightboxIndex(lightboxIndex - 1) : undefined
          }
          onNext={
            lightboxIndex < photos.length - 1
              ? () => setLightboxIndex(lightboxIndex + 1)
              : undefined
          }
        />
      )}
    </div>
  );
}
