import { Star } from "lucide-react";

export function StarRating({
  value,
  onChange,
  readOnly = false,
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  readOnly?: boolean;
}) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, star: number) {
    if (readOnly || !onChange) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(star < 5 ? star + 1 : 5);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(star > 1 ? star - 1 : 1);
    }
  }

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value != null && star <= value;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={filled}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            disabled={readOnly}
            onClick={() => onChange?.(value === star ? null : star)}
            onKeyDown={(e) => handleKeyDown(e, star)}
            className={`rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:focus-visible:ring-slate-300 ${
              readOnly ? "cursor-default" : "cursor-pointer"
            }`}
          >
            <Star
              size={24}
              fill={filled ? "currentColor" : "none"}
              className={filled ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}
            />
          </button>
        );
      })}
    </div>
  );
}
