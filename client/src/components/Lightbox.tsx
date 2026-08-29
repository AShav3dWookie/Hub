import { useEffect, useRef, type ReactNode } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

const SWIPE_THRESHOLD = 50; // px of horizontal travel to count as a swipe

/**
 * Full-screen image overlay. Closes on Escape, backdrop click, or the X button.
 * When `onPrev` / `onNext` are passed, shows arrow buttons and responds to arrow
 * keys and horizontal swipes for that direction.
 * `children` renders as a caption / toolbar strip under the image.
 */
export function Lightbox({
  src,
  alt,
  onClose,
  onPrev,
  onNext,
  children,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  children?: ReactNode;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    swiped.current = true; // swallow the trailing synthetic click
    if (dx > 0) onPrev?.();
    else onNext?.();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={() => {
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        onClose();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={20} />
      </button>
      {onPrev && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {onNext && (
        <button
          type="button"
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <ChevronRight size={24} />
        </button>
      )}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-md object-contain"
      />
      {children != null && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="max-w-full text-center text-sm text-white"
        >
          {children}
        </div>
      )}
    </div>
  );
}
