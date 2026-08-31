CREATE TABLE `sync_deletions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`row_seq` integer NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_deletions_row_seq_idx` ON `sync_deletions` (`row_seq`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`next_row_seq` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `albums` ADD `row_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `albums` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `albums_row_seq_idx` ON `albums` (`row_seq`);--> statement-breakpoint
ALTER TABLE `entities` ADD `row_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `entities_row_seq_idx` ON `entities` (`row_seq`);--> statement-breakpoint
ALTER TABLE `entity_notes` ADD `row_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entity_notes` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `entity_notes_row_seq_idx` ON `entity_notes` (`row_seq`);--> statement-breakpoint
ALTER TABLE `log_photos` ADD `row_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `log_photos` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `log_photos_row_seq_idx` ON `log_photos` (`row_seq`);--> statement-breakpoint
ALTER TABLE `logs` ADD `row_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `logs` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `logs_row_seq_idx` ON `logs` (`row_seq`);--> statement-breakpoint

/*
 * Delta-sync change-feed plumbing (hand-written; drizzle-kit does not model triggers).
 *
 * `sync_state` is a one-row global counter. Every insert/update of a syncable row claims the
 * current `next_row_seq` and increments it, via the triggers below; `sync_deletions` records a
 * tombstone (with its own `row_seq`) for every hard delete, including ON DELETE CASCADE
 * deletes (`recursive_triggers` is ON — see db/client.ts). The sync cursor is a `row_seq`
 * high-watermark, so a single ordered stream carries adds, updates and deletes.
 *
 * The `AFTER UPDATE ... WHEN NEW.row_seq = OLD.row_seq` guard stops the trigger's own
 * `row_seq` write from re-triggering itself. Join-table triggers touch the parent row's
 * `updated_at`, which the parent's own AFTER UPDATE trigger turns into a `row_seq` bump.
 */
INSERT INTO `sync_state` (`id`, `next_row_seq`) VALUES (1, 1);--> statement-breakpoint

-- Backfill a deterministic global ordering over existing rows: all entities, then all logs,
-- then log_photos, albums, entity_notes; within each table by ascending id.
UPDATE `entities` SET `row_seq` =
  (SELECT COUNT(*) FROM `entities` t2 WHERE t2.`id` <= `entities`.`id`);--> statement-breakpoint
UPDATE `logs` SET `row_seq` =
  (SELECT COUNT(*) FROM `entities`)
  + (SELECT COUNT(*) FROM `logs` t2 WHERE t2.`id` <= `logs`.`id`);--> statement-breakpoint
UPDATE `log_photos` SET `row_seq` =
  (SELECT COUNT(*) FROM `entities`) + (SELECT COUNT(*) FROM `logs`)
  + (SELECT COUNT(*) FROM `log_photos` t2 WHERE t2.`id` <= `log_photos`.`id`);--> statement-breakpoint
UPDATE `albums` SET `row_seq` =
  (SELECT COUNT(*) FROM `entities`) + (SELECT COUNT(*) FROM `logs`) + (SELECT COUNT(*) FROM `log_photos`)
  + (SELECT COUNT(*) FROM `albums` t2 WHERE t2.`id` <= `albums`.`id`);--> statement-breakpoint
UPDATE `entity_notes` SET `row_seq` =
  (SELECT COUNT(*) FROM `entities`) + (SELECT COUNT(*) FROM `logs`) + (SELECT COUNT(*) FROM `log_photos`) + (SELECT COUNT(*) FROM `albums`)
  + (SELECT COUNT(*) FROM `entity_notes` t2 WHERE t2.`id` <= `entity_notes`.`id`);--> statement-breakpoint
UPDATE `sync_state` SET `next_row_seq` =
  (SELECT COUNT(*) FROM `entities`) + (SELECT COUNT(*) FROM `logs`) + (SELECT COUNT(*) FROM `log_photos`)
  + (SELECT COUNT(*) FROM `albums`) + (SELECT COUNT(*) FROM `entity_notes`) + 1
  WHERE `id` = 1;--> statement-breakpoint

CREATE TRIGGER `entities_sync_ai` AFTER INSERT ON `entities` BEGIN
  UPDATE `entities` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `entities_sync_au` AFTER UPDATE ON `entities` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `entities` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `entities_sync_ad` AFTER DELETE ON `entities` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('entity', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

CREATE TRIGGER `logs_sync_ai` AFTER INSERT ON `logs` BEGIN
  UPDATE `logs` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `logs_sync_au` AFTER UPDATE ON `logs` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `logs` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `logs_sync_ad` AFTER DELETE ON `logs` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('log', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

CREATE TRIGGER `log_photos_sync_ai` AFTER INSERT ON `log_photos` BEGIN
  UPDATE `log_photos` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `log_photos_sync_au` AFTER UPDATE ON `log_photos` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `log_photos` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `log_photos_sync_ad` AFTER DELETE ON `log_photos` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('log_photo', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

CREATE TRIGGER `albums_sync_ai` AFTER INSERT ON `albums` BEGIN
  UPDATE `albums` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `albums_sync_au` AFTER UPDATE ON `albums` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `albums` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `albums_sync_ad` AFTER DELETE ON `albums` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('album', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

CREATE TRIGGER `entity_notes_sync_ai` AFTER INSERT ON `entity_notes` BEGIN
  UPDATE `entity_notes` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `entity_notes_sync_au` AFTER UPDATE ON `entity_notes` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `entity_notes` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `entity_notes_sync_ad` AFTER DELETE ON `entity_notes` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('entity_note', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

-- Join-table edits are folded into the parent row's row_seq: touching updated_at makes the
-- parent's own AFTER UPDATE trigger claim a fresh row_seq. The EXISTS guard skips the touch
-- when the parent is itself being deleted (its cascade removes these rows).
CREATE TRIGGER `log_people_sync_ai` AFTER INSERT ON `log_people` BEGIN
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = NEW.`log_id`;
END;--> statement-breakpoint
CREATE TRIGGER `log_people_sync_ad` AFTER DELETE ON `log_people`
  WHEN EXISTS (SELECT 1 FROM `logs` WHERE `id` = OLD.`log_id`) BEGIN
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = OLD.`log_id`;
END;--> statement-breakpoint
CREATE TRIGGER `album_events_sync_ai` AFTER INSERT ON `album_events` BEGIN
  UPDATE `albums` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = NEW.`album_id`;
END;--> statement-breakpoint
CREATE TRIGGER `album_events_sync_ad` AFTER DELETE ON `album_events`
  WHEN EXISTS (SELECT 1 FROM `albums` WHERE `id` = OLD.`album_id`) BEGIN
  UPDATE `albums` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = OLD.`album_id`;
END;--> statement-breakpoint
CREATE TRIGGER `album_people_sync_ai` AFTER INSERT ON `album_people` BEGIN
  UPDATE `albums` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = NEW.`album_id`;
END;--> statement-breakpoint
CREATE TRIGGER `album_people_sync_ad` AFTER DELETE ON `album_people`
  WHEN EXISTS (SELECT 1 FROM `albums` WHERE `id` = OLD.`album_id`) BEGIN
  UPDATE `albums` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = OLD.`album_id`;
END;