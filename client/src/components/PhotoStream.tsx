import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GalleryPhotoDTO } from "@logger/shared";
import { Lightbox } from "./Lightbox.js";

/**
 * A paginated photo grid with a click-to-open lightbox. Shared by the main Gallery
 * page and a person's profile. When `onDelete` is passed, the lightbox shows a
 * delete-confirm; otherwise the grid is view-only.
 */
export function PhotoStream({
  photos,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  emptyText,
  onDelete,
}: {
  photos: GalleryPhotoDTO[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  emptyText: string;
  onDelete?: (photoId: number) => Promise<void>;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false); // waiting on fetchNextPage for the next photo
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const active = activeIndex == null ? null : photos[activeIndex] ?? null;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [activeIndex]);

  // Once a freshly fetched page has landed, step onto the photo we were headed for.
  useEffect(() => {
    if (!advancing) return;
    if (activeIndex != null && activeIndex < photos.length - 1) {
      setActiveIndex(activeIndex + 1);
      setAdvancing(false);
    } else if (!hasNextPage && !isFetchingNextPage) {
      setAdvancing(false); // no more pages are coming
    }
  }, [advancing, activeIndex, photos.length, hasNextPage, isFetchingNextPage]);

  const canPrev = activeIndex != null && activeIndex > 0;
  const canNext =
    activeIndex != null && (activeIndex < photos.length - 1 || hasNextPage);

  function goPrev() {
    if (activeIndex != null && activeIndex > 0) setActiveIndex(activeIndex - 1);
  }

  function goNext() {
    if (activeIndex == null) return;
    if (activeIndex < photos.length - 1) {
      setActiveIndex(activeIndex + 1);
    } else if (hasNextPage && !isFetchingNextPage) {
      setAdvancing(true);
      fetchNextPage();
    }
  }

  function close() {
    setActiveIndex(null);
    setConfirmingDelete(false);
    setAdvancing(false);
  }

  async function handleDelete(photoId: number) {
    if (!onDelete) return;
    await onDelete(photoId);
    close();
  }

  return (
    <>
      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}

      {!isLoading && photos.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">{emptyText}</p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActiveIndex(i)}
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
        <Lightbox
          src={active.url}
          alt={active.originalName}
          onClose={close}
          onPrev={canPrev ? goPrev : undefined}
          onNext={canNext && !advancing ? goNext : undefined}
        >
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

            {onDelete &&
              (confirmingDelete ? (
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
              ))}
          </div>
        </Lightbox>
      )}
    </>
  );
}
