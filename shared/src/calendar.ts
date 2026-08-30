import type { Category } from "./categories.js";

/**
 * Read-only calendar aggregation. The calendar is a window onto the existing event system —
 * `logs` in the eating_out / hang_out / appointment categories, and `important_date` notes
 * placed on their annual month+day occurrence in whatever year is being viewed.
 */

export type CalendarItemKind = "log" | "important_date";

export interface CalendarItem {
  /** The placed occurrence — always a real YYYY-MM-DD inside the requested range. */
  date: string;
  kind: CalendarItemKind;
  category: "eating_out" | "hang_out" | "appointment" | "important_date";
  /** Entity title, or the person's name for an important date. */
  title: string;
  /** `logs.notes`, or the important_date note's body ("" is normalised to null). */
  notes: string | null;
  entityId: number;
  /** Lets the client link to /person/:id vs /entity/:id. */
  entityCategory: Category;
  /** important_date only, e.g. "Birthday". */
  tag?: string;
  /** kind === "log". */
  logId?: number;
  /** kind === "important_date". */
  noteId?: number;
}

/** Response for GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD (both inclusive). */
export interface CalendarRangeResponse {
  from: string;
  to: string;
  /** Sorted by date, then title, then kind, then logId ?? noteId. */
  items: CalendarItem[];
}
