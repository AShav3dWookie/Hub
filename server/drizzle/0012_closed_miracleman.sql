CREATE TABLE `list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`row_seq` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_items_list_id_normalized_text_idx` ON `list_items` (`list_id`,`normalized_text`);--> statement-breakpoint
CREATE INDEX `list_items_row_seq_idx` ON `list_items` (`row_seq`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`row_seq` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_kind_normalized_name_idx` ON `lists` (`kind`,`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_one_default_per_kind_idx` ON `lists` (`kind`) WHERE `is_default` = 1;--> statement-breakpoint
CREATE INDEX `lists_row_seq_idx` ON `lists` (`row_seq`);--> statement-breakpoint

-- Delta-sync triggers, the same shape as migration 0007's. Item counts are derived from the
-- items on both sides, so unlike `log_photos` -> `logs` an item write doesn't touch its list.
-- Deleting a list cascades to its items, and `recursive_triggers` gives each one a tombstone.
CREATE TRIGGER `lists_sync_ai` AFTER INSERT ON `lists` BEGIN
  UPDATE `lists` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `lists_sync_au` AFTER UPDATE ON `lists` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `lists` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `lists_sync_ad` AFTER DELETE ON `lists` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('list', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

CREATE TRIGGER `list_items_sync_ai` AFTER INSERT ON `list_items` BEGIN
  UPDATE `list_items` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `list_items_sync_au` AFTER UPDATE ON `list_items` WHEN NEW.`row_seq` = OLD.`row_seq` BEGIN
  UPDATE `list_items` SET `row_seq` = (SELECT `next_row_seq` FROM `sync_state`), `version` = `version` + 1 WHERE `id` = NEW.`id`;
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `list_items_sync_ad` AFTER DELETE ON `list_items` BEGIN
  INSERT INTO `sync_deletions` (`entity_type`, `entity_id`, `row_seq`, `deleted_at`)
    VALUES ('list_item', OLD.`id`, (SELECT `next_row_seq` FROM `sync_state`), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE `sync_state` SET `next_row_seq` = `next_row_seq` + 1;
END;--> statement-breakpoint

-- Every kind always has a main list; this is the shopping one. Inserted after the triggers so
-- it gets a row_seq and reaches existing clients through the change feed.
INSERT INTO `lists` (`kind`, `name`, `normalized_name`, `is_default`, `created_at`, `updated_at`)
  VALUES ('shopping', 'Shopping', 'shopping', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
