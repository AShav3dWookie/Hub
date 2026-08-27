import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Category } from "@logger/shared";

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
  },
  (table) => ({
    categoryNormalizedTitleIdx: index("entities_category_normalized_title_idx").on(
      table.category,
      table.normalizedTitle,
    ),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => ({
    entityIdIdx: index("logs_entity_id_idx").on(table.entityId),
    dateIdx: index("logs_date_idx").on(table.date),
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
    logId: integer("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    thumbnailFilename: text("thumbnail_filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => ({
    logIdIdx: index("log_photos_log_id_idx").on(table.logId),
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
  },
  (table) => ({
    entityIdIdx: index("entity_notes_entity_id_idx").on(table.entityId),
  }),
);
