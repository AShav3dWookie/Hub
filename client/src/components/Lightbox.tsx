import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

const SWIPE_THRESHOLD = 60; // px of horizontal travel to commit a swipe
const AXIS_LOCK = 8; // px of travel before we decide the gesture is horizontal / vertical
const SETTLE_MS = 220;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

type Settling = "prev" | "next" | "back" | null;

/**
 * Full-screen image overlay. Closes on Escape, backdrop click, or the X button.
 * When `onPrev` / `onNext` are passed, shows arrow buttons and responds to arrow
 * keys and horizontal swipes for that direction; `prevSrc` / `nextSrc` supply the
 * neighbouring frames so navigation slides instead of hard-cutting.
 * `children` renders as a caption / toolbar strip under the image.
 */
export function Lightbox({
  src,
  alt,
  onClose,
  onPrev,
  onNext,
  prevSrc,
  nextSrc,
  children,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  prevSrc?: string;
  nextSrc?: string;
  children?: ReactNode;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  const swiped = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const settlingRef = useRef<Settling>(null);

  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState<Settling>(null);

  // A swap of `src` (our own commit, a delete, or an external jump) resettles the track.
  useEffect(() => {
    setDragX(0);
    setSettling(null);
    settlingRef.current = null;
  }, [src]);

  function beginSettle(dir: Exclude<Settling, null>) {
    settlingRef.current = dir;
    setSettling(dir);
  }

  // Not run inside a state updater (StrictMode double-invokes those) — guarded to be idempotent.
  function finishSettle() {
    const s = settlingRef.current;
    if (!s) return;
    settlingRef.current = null;
    if (s === "next") onNext?.();
    else if (s === "prev") onPrev?.();
    setSettling(null);
    setDragX(0);
  }

  // Backstop in case `transitionend` never fires (0px move, background tab, reduced motion).
  useEffect(() => {
    if (!settling) return;
    const t = window.setTimeout(finishSettle, SETTLE_MS + 40);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling]);

  function slideTo(dir: "prev" | "next") {
    if (settling) return;
    const handler = dir === "prev" ? onPrev : onNext;
    if (!handler) return;
    if (prefersReducedMotion()) handler();
    else beginSettle(dir);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") slideTo("prev");
      else if (e.key === "ArrowRight") slideTo("next");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onPrev, onNext, settling]);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
    axis.current = null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    const start = touchStart.current;
    const t = e.touches[0];
    if (!start || !t || settling) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axis.current === null) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis.current !== "x") return;
    swiped.current = true; // swallow the trailing synthetic click
    const navigable = dx > 0 ? Boolean(onPrev) : Boolean(onNext);
    setDragX(navigable ? dx : dx / 3); // rubber-band past the ends
  }

  function handleTouchEnd() {
    const wasHorizontal = axis.current === "x";
    axis.current = null;
    touchStart.current = null;
    if (!wasHorizontal) {
      setDragX(0);
      return;
    }
    const dir = dragX > 0 ? "prev" : "next";
    const handler = dir === "prev" ? onPrev : onNext;
    if (Math.abs(dragX) >= SWIPE_THRESHOLD && handler) {
      if (prefersReducedMotion()) {
        handler();
        setDragX(0);
      } else {
        beginSettle(dir);
      }
      return;
    }
    if (prefersReducedMotion()) setDragX(0);
    else beginSettle("back");
  }

  const offset =
    settling === "next"
      ? "-200%"
      : settling === "prev"
        ? "0%"
        : settling === "back"
          ? "-100%"
          : `calc(-100% + ${dragX}px)`;

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
      onTouchMove={handleTouchMove}
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
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={20} />
      </button>
      {onPrev && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            slideTo("prev");
          }}
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
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
            slideTo("next");
          }}
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div className="relative w-full min-h-0 flex-1 overflow-hidden" style={{ touchAction: "pan-y" }}>
        <div
          ref={trackRef}
          data-testid="lightbox-track"
          onTransitionEnd={(e) => {
            // only the track's own transform transition, not one bubbled from a child
            if (e.target === e.currentTarget) finishSettle();
          }}
          className="flex h-full w-full"
          style={{
            transform: `translateX(${offset})`,
            transition: settling
              ? `transform ${SETTLE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
              : "none",
            willChange: "transform",
          }}
        >
          <div className="flex h-full w-full shrink-0 items-center justify-center">
            {prevSrc && (
              <img src={prevSrc} alt="" className="max-h-full max-w-full rounded-md object-contain" />
            )}
          </div>
          <div className="flex h-full w-full shrink-0 items-center justify-center">
            <img
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>
          <div className="flex h-full w-full shrink-0 items-center justify-center">
            {nextSrc && (
              <img src={nextSrc} alt="" className="max-h-full max-w-full rounded-md object-contain" />
            )}
          </div>
        </div>
      </div>

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
