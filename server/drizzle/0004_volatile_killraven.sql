PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_log_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` integer,
	`filename` text NOT NULL,
	`thumbnail_filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `logs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_log_photos`("id", "log_id", "filename", "thumbnail_filename", "original_name", "mime_type", "size", "created_at") SELECT "id", "log_id", "filename", "thumbnail_filename", "original_name", "mime_type", "size", "created_at" FROM `log_photos`;--> statement-breakpoint
DROP TABLE `log_photos`;--> statement-breakpoint
ALTER TABLE `__new_log_photos` RENAME TO `log_photos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `log_photos_log_id_idx` ON `log_photos` (`log_id`);