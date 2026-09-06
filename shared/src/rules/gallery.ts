/**
 * Gallery paging rules, shared by the server's `galleryService` and the offline client's query
 * layer. The two fetch very differently — SQL joins versus a snapshot walk — but they must
 * agree on the page size, the ordering key and what the next cursor is.
 */

export const DEFAULT_GALLERY_LIMIT = 50;

export interface GalleryQuery {
  cursor?: number;
  limit?: number;
  /**
   * When set, restrict to photos credited to this person: photos whose parent log tags them,
   * or loose photos of an album they were added to directly.
   */
  personId?: number;
  /**
   * When set, restrict to an album's photos: its loose photos plus every photo of a linked
   * event's log. Pass at most one of personId / albumId.
   */
  albumId?: number;
}

export interface GalleryPage<T> {
  page: T[];
  nextCursor: number | null;
}

/**
 * Take one page from a list already ordered by descending id.
 *
 * The gallery is ordered by photo id, which is monotonic with upload time, so the cursor is a
 * plain integer and paging never needs a compound key. Callers pass more than `limit` items
 * when more exist — the server selects `limit + 1` rows, the client filters its whole snapshot
 * — and the surplus is what proves another page follows. `nextCursor` is null on the last page,
 * so there is never a trailing empty one.
 */
export function paginateByDescendingId<T>(
  ordered: readonly T[],
  limit: number,
  idOf: (item: T) => number,
): GalleryPage<T> {
  const hasMore = ordered.length > limit;
  const page = hasMore ? ordered.slice(0, limit) : [...ordered];
  return {
    page,
    nextCursor: hasMore && page.length > 0 ? idOf(page[page.length - 1]) : null,
  };
}

/** Whether a photo id is still ahead of the cursor. A missing cursor accepts everything. */
export function isAfterCursor(id: number, cursor: number | undefined): boolean {
  return cursor == null || id < cursor;
}
