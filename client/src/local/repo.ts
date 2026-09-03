/**
 * The offline read API. Each method loads a {@link LocalSnapshot} and delegates to the pure
 * port in `queries.ts`, returning the same DTO shape the matching `/api` endpoint does.
 *
 * Branch 4 swaps the TanStack Query `queryFn`s over to these (the query keys stay the same).
 * Nothing here writes — the lite tier's replica is a pure projection of server state.
 */
import type { Category, GalleryQuery, SearchQuery } from "@logger/shared";
import { loadSnapshot } from "./snapshot.js";
import * as q from "./queries.js";

export { LocalNotFoundError } from "./queries.js";
export type { EntityDetail } from "./queries.js";
export type { GalleryQuery };

export const repo = {
  async searchEntitiesByTitle(category: Category, query: string, limit?: number) {
    return q.searchEntitiesByTitle(await loadSnapshot(), category, query, limit);
  },

  async getEntityDetail(id: number) {
    return q.getEntityDetail(await loadSnapshot(), id);
  },

  async search(query: SearchQuery) {
    return q.search(await loadSnapshot(), query);
  },

  async getGallery(query: GalleryQuery = {}) {
    return q.getGallery(await loadSnapshot(), query);
  },

  async listAlbums() {
    return q.listAlbums(await loadSnapshot());
  },

  async getAlbum(id: number) {
    return q.getAlbum(await loadSnapshot(), id);
  },

  async listEntityNotes(entityId: number) {
    return q.listEntityNotes(await loadSnapshot(), entityId);
  },

  async getCalendarRange(from: string, to: string) {
    return q.getCalendarRange(await loadSnapshot(), from, to);
  },

  async getUpcomingImportantDates() {
    return q.getUpcomingImportantDates(await loadSnapshot());
  },

  async getUpcomingEvents() {
    return q.getUpcomingEvents(await loadSnapshot());
  },
};

export type Repo = typeof repo;
