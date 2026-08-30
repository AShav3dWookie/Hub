import type { AlbumRef, LogWithEntityDTO, PersonRef, PersonTagInput } from "./types.js";

/**
 * An album is a standalone, curated grouping of existing logs ("events") plus album-only
 * ("loose") photos and people. It never modifies the events it references. Albums are NOT
 * `entities` rows and "album" is deliberately not a member of CATEGORIES — a small
 * ALBUM_ADD_ITEM constant drives the extra Add-menu tile and Search filter tab instead.
 */
export interface AlbumSummary extends AlbumRef {
  notes: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  photoCount: number;
}

export interface AlbumDTO extends AlbumSummary {
  /** Linked logs, built with photos:[] + albums:[] (the album page gets photos from the aggregated stream). */
  events: LogWithEntityDTO[];
  /** Union of directly-added people and people tagged on any linked event, deduped, name-sorted. */
  people: PersonRef[];
  /** The subset of `people` that were added directly (album_people) — the only ones the UI can remove. */
  directPersonIds: number[];
}

export interface CreateAlbumRequest {
  title: string;
  notes?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  people?: PersonTagInput[];
  eventLogIds?: number[];
}

export type UpdateAlbumRequest = Pick<
  CreateAlbumRequest,
  "title" | "notes" | "dateStart" | "dateEnd"
>;

/** Drives the extra "Album" tile on the Add screen and the extra tab on Search. */
export const ALBUM_ADD_ITEM = {
  path: "album",
  label: "Album",
  icon: "GalleryVerticalEnd",
} as const;
