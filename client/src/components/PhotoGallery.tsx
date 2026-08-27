import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { LogPhotoDTO } from "@logger/shared";
import { useUploadLogPhotos, useDeleteLogPhoto } from "../api/hooks.js";
import { useToast } from "./ToastProvider.js";

const MAX_PHOTOS = 10;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export function PhotoGallery({ logId, photos }: { logId: number; photos: LogPhotoDTO[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<LogPhotoDTO | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const upload = useUploadLogPhotos(logId);
  const deletePhoto = useDeleteLogPhoto(logId);
  const { showToast } = useToast();

  const atLimit = photos.length >= MAX_PHOTOS;

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (photos.length + files.length > MAX_PHOTOS) {
      showToast(`A log can have at most ${MAX_PHOTOS} photos`);
      return;
    }
    try {
      await upload.mutateAsync(files);
      showToast(files.length === 1 ? "Photo added" : `${files.length} photos added`);
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
        {photos.map((photo) => (
          <div key={photo.id} className="relative">
            <button
              type="button"
              onClick={() => setLightbox(photo)}
              className="block h-20 w-20 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.originalName}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              aria-label={`Delete ${photo.originalName}`}
              onClick={() => setConfirmingDelete(photo.id)}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900/80 p-1 text-white hover:bg-red-600"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {!atLimit && (
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

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handleFiles}
        className="hidden"
        data-testid="photo-file-input"
      />

      {confirmingDelete != null && (
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Delete this photo?</span>
          <button
            type="button"
            onClick={() => handleDelete(confirmingDelete)}
            className="min-h-[44px] rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(null)}
            className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-200"
          >
            Cancel
          </button>
        </div>
      )}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.originalName}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X size={20} />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.originalName}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      )}
    </div>
  );
}
