import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Category } from "@logger/shared";

/**
 * Delta-sync bookkeeping columns, present on every table the change-feed
 * (`GET /api/sync/changes`) replicates. `row_seq` is a globally monotonic sequence number
 * assigned by DB triggers on every insert/update (see migration 0007); the sync cursor is a
 * `row_seq` high-watermark. `version` bumps on every update — unused by the pull-only lite
 * tier, kept so the DTO envelope is stable for the future writes tier's conflict checks.
 * Both are trigger-maintained: application code never sets them.
 */
const syncColumns = {
  rowSeq: integer("row_seq").notNull().default(0),
  version: integer("version").notNull().default(1),
};

export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category: text("category").$type<Category>().notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    releaseYear: integer("release_year"),
    author: text("author"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    ...syncColumns,
  },
  (table) => ({
    categoryNormalizedTitleIdx: index("entities_category_normalized_title_idx").on(
      table.category,
      table.normalizedTitle,
    ),
    rowSeqIdx: index("entities_row_seq_idx").on(table.rowSeq),
  }),
);

export const logs = sqliteTable(
  "logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    rating: integer("rating"),
    date: text("date").notNull(),
    notes: text("notes"),
    // Appointments only: when true, a startup/on-read sweep deletes this log once its date has passed.
    autoDelete: integer("auto_delete", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    ...syncColumns,
  },
  (table) => ({
    entityIdIdx: index("logs_entity_id_idx").on(table.entityId),
    dateIdx: index("logs_date_idx").on(table.date),
    rowSeqIdx: index("logs_row_seq_idx").on(table.rowSeq),
  }),
);

export const logPeople = sqliteTable(
  "log_people",
  {
    logId: integer("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade" }),
    personEntityId: integer("person_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (table) => ({
    uniquePair: uniqueIndex("log_people_log_id_person_entity_id_idx").on(
      table.logId,
      table.personEntityId,
    ),
    personEntityIdIdx: index("log_people_person_entity_id_idx").on(table.personEntityId),
  }),
);

export const logPhotos = sqliteTable(
  "log_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Nullable + set null (not cascade): deleting a log can keep its photos as
    // gallery-only orphans. See logService.deleteLog / routes/logs DELETE.
    logId: integer("log_id").references(() => logs.id, { onDelete: "set null" }),
    // A photo belongs to a log (logId set) OR directly to an album ("loose", albumId set)
    // OR neither (gallery orphan) — never both. Enforced in the service layer, not the DB.
    albumId: integer("album_id").references(() => albums.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    thumbnailFilename: text("thumbnail_filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    ...syncColumns,
  },
  (table) => ({
    logIdIdx: index("log_photos_log_id_idx").on(table.logId),
    albumIdIdx: index("log_photos_album_id_idx").on(table.albumId),
    rowSeqIdx: index("log_photos_row_seq_idx").on(table.rowSeq),
  }),
);

export const albums = sqliteTable(
  "albums",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    notes: text("notes"),
    dateStart: text("date_start"),
    dateEnd: text("date_end"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    ...syncColumns,
  },
  (table) => ({
    rowSeqIdx: index("albums_row_seq_idx").on(table.rowSeq),
  }),
);

export const albumEvents = sqliteTable(
  "album_events",
  {
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    logId: integer("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade" }),
  },
  (table) => ({
    uniquePair: uniqueIndex("album_events_album_id_log_id_idx").on(table.albumId, table.logId),
    logIdIdx: index("album_events_log_id_idx").on(table.logId),
  }),
);

export const albumPeople = sqliteTable(
  "album_people",
  {
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    personEntityId: integer("person_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (table) => ({
    uniquePair: uniqueIndex("album_people_album_id_person_entity_id_idx").on(
      table.albumId,
      table.personEntityId,
    ),
    personEntityIdIdx: index("album_people_person_entity_id_idx").on(table.personEntityId),
  }),
);

export const entityNotes = sqliteTable(
  "entity_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("general"),
    body: text("body").notNull(),
    tag: text("tag"),
    eventDate: text("event_date"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    ...syncColumns,
  },
  (table) => ({
    entityIdIdx: index("entity_notes_entity_id_idx").on(table.entityId),
    rowSeqIdx: index("entity_notes_row_seq_idx").on(table.rowSeq),
  }),
);

/**
 * Single-row global counter backing `row_seq` assignment. Row `id = 1` always exists (seeded
 * by migration 0007); `next_row_seq` is the value the next trigger-driven write will claim.
 * Maintained entirely by triggers.
 */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  nextRowSeq: integer("next_row_seq").notNull(),
});

/** The tables whose deletions the change-feed reports as tombstones. */
export type SyncEntityType = "entity" | "log" | "log_photo" | "album" | "entity_note";

/**
 * Tombstone log. Every hard delete of a syncable row inserts a row here (via an `AFTER DELETE`
 * trigger) carrying a fresh `row_seq`, so `GET /api/sync/changes` can tell clients which rows
 * to drop. Deletions caused by `ON DELETE CASCADE` are captured too (`recursive_triggers` is
 * ON — see db/client.ts).
 */
export const syncDeletions = sqliteTable(
  "sync_deletions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").$type<SyncEntityType>().notNull(),
    entityId: integer("entity_id").notNull(),
    rowSeq: integer("row_seq").notNull(),
    deletedAt: text("deleted_at").notNull(),
  },
  (table) => ({
    rowSeqIdx: index("sync_deletions_row_seq_idx").on(table.rowSeq),
  }),
);
