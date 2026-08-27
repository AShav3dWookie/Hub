import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Full-screen image overlay. Closes on Escape, backdrop click, or the X button.
 * `children` renders as a caption / toolbar strip under the image.
 */
export function Lightbox({
  src,
  alt,
  onClose,
  children,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
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
