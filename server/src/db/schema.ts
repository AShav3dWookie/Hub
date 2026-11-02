import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Category, ListKind, NotificationSlot, SyncEntityType } from "@logger/shared";

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
    // Appointments only: optional local time of day, "HH:MM". Null means untimed (all day).
    time: text("time"),
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
 * General-purpose lists (shopping is the only kind so far). Unique by normalized name within a
 * kind, so a spoken list name can never match two lists; the partial unique index allows
 * exactly one default ("main") list per kind. Migration 0012 seeds the main shopping list.
 */
export const lists = sqliteTable(
  "lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<ListKind>().notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    // Where the shop is, tagged from the companion app (#5). All three or none; the app's
    // geofence fires after a minute inside radius_m metres of the point.
    latitude: real("latitude"),
    longitude: real("longitude"),
    radiusM: integer("radius_m"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...syncColumns,
  },
  (table) => ({
    kindNameIdx: uniqueIndex("lists_kind_normalized_name_idx").on(table.kind, table.normalizedName),
    oneDefaultIdx: uniqueIndex("lists_one_default_per_kind_idx")
      .on(table.kind)
      .where(sql`${table.isDefault} = 1`),
    rowSeqIdx: index("lists_row_seq_idx").on(table.rowSeq),
  }),
);

/** A list's entries. Unique by normalized text within a list — adding a duplicate is a no-op. */
export const listItems = sqliteTable(
  "list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listId: integer("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...syncColumns,
  },
  (table) => ({
    listTextIdx: uniqueIndex("list_items_list_id_normalized_text_idx").on(
      table.listId,
      table.normalizedText,
    ),
    rowSeqIdx: index("list_items_row_seq_idx").on(table.rowSeq),
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

/**
 * Idempotency log for `POST /api/sync/mutations`. Each replayed `mutation_id` returns its
 * stored result instead of re-applying — so a client that retries a batch after a network
 * blip (server applied, client never got the response) can't double-create. Not a syncable
 * table; no triggers.
 */
export const syncAppliedMutations = sqliteTable("sync_applied_mutations", {
  mutationId: text("mutation_id").primaryKey(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Generic key/value store for mutable server settings that must outlive a single env var.
 * Plain and non-syncable (no `syncColumns`, no triggers) — server-only, never in the change feed.
 * First key: `auth.password_hash`, the bcrypt hash of the login password once it has been changed
 * away from the `AUTH_PASSWORD_HASH` seed. See `authCredentialsService`.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * One row per device that has turned push notifications on. `endpoint` is the push service URL
 * the browser handed out and is the device's identity; `p256dh` + `auth` are the keys the payload
 * is encrypted to. Server-only and non-syncable, like `app_settings`. A row is deleted when the
 * push service reports the subscription gone (404/410). See `pushSubscriptionsService`.
 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  lastSuccessAt: text("last_success_at"),
});

/**
 * Non-browser callers allowed to use the API — the Android companion app's voice widget now,
 * location triggers later. Each is named after its device and authenticates with
 * `Authorization: Bearer <token>`. Only the token's SHA-256 is kept: tokens are 256 random bits,
 * so a slow hash buys nothing, and a fast one lets the lookup be a plain indexed equality.
 * Server-only and non-syncable, like `push_subscriptions`. See `deviceTokensService`.
 */
export const deviceTokens = sqliteTable("device_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

/**
 * Which items each reminder slot has already announced, so a scheduler tick — every minute, and
 * again after a restart — never repeats one. Per item rather than per slot, so something added
 * after 9pm for tomorrow still gets a late notification of its own. Pruned after 30 days.
 * See `notificationScheduler`.
 */
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    slot: text("slot").$type<NotificationSlot>().notNull(),
    /**
     * The local date the slot fired on (`YYYY-MM-DD`), not the item's own date — except for
     * `hour_before`, which records the appointment's date (its window can span midnight).
     */
    firedOn: text("fired_on").notNull(),
    itemKey: text("item_key").notNull(),
    sentAt: text("sent_at").notNull(),
  },
  (table) => ({
    uniqueDelivery: uniqueIndex("notification_deliveries_slot_fired_on_item_key_idx").on(
      table.slot,
      table.firedOn,
      table.itemKey,
    ),
  }),
);
