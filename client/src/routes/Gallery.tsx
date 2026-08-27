import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GalleryPhotoDTO } from "@logger/shared";
import { useGallery, useDeleteGalleryPhoto } from "../api/hooks.js";
import { Lightbox } from "../components/Lightbox.js";
import { useToast } from "../components/ToastProvider.js";

export function Gallery() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useGallery();
  const [active, setActive] = useState<GalleryPhotoDTO | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const deletePhoto = useDeleteGalleryPhoto();
  const { showToast } = useToast();

  const photos = data?.pages.flatMap((page) => page.photos) ?? [];

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  function closeLightbox() {
    setActive(null);
    setConfirmingDelete(false);
  }

  async function handleDelete(photoId: number) {
    try {
      await deletePhoto.mutateAsync(photoId);
      closeLightbox();
      showToast("Photo deleted");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete photo");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Gallery</h1>

      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}

      {!isLoading && photos.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">
          No photos yet — add some from a movie or a meal.
        </p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => {
                setActive(photo);
                setConfirmingDelete(false);
              }}
              className="aspect-square overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.originalName}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Loading more…</p>
      )}

      {active && (
        <Lightbox src={active.url} alt={active.originalName} onClose={closeLightbox}>
          <div className="flex flex-col items-center gap-2">
            {active.log ? (
              <span>
                <Link to={`/entity/${active.log.entityId}`} className="underline">
                  {active.log.entityTitle}
                </Link>{" "}
                · {active.log.date}
              </span>
            ) : (
              <span className="text-slate-300">Not linked to an event</span>
            )}

            {confirmingDelete ? (
              <span className="flex items-center gap-3">
                <span>Delete this photo?</span>
                <button
                  type="button"
                  onClick={() => handleDelete(active.id)}
                  className="min-h-[44px] rounded-md bg-red-600 px-3 font-medium text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="min-h-[44px] rounded-md border border-white/40 px-3"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="min-h-[44px] rounded-md border border-white/40 px-3 text-red-300 hover:bg-white/10"
              >
                Delete photo
              </button>
            )}
          </div>
        </Lightbox>
      )}
    </div>
  );
}
