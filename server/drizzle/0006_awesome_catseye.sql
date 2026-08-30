CREATE TABLE `album_events` (
	`album_id` integer NOT NULL,
	`log_id` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`log_id`) REFERENCES `logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_events_album_id_log_id_idx` ON `album_events` (`album_id`,`log_id`);--> statement-breakpoint
CREATE INDEX `album_events_log_id_idx` ON `album_events` (`log_id`);--> statement-breakpoint
CREATE TABLE `album_people` (
	`album_id` integer NOT NULL,
	`person_entity_id` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_people_album_id_person_entity_id_idx` ON `album_people` (`album_id`,`person_entity_id`);--> statement-breakpoint
CREATE INDEX `album_people_person_entity_id_idx` ON `album_people` (`person_entity_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`date_start` text,
	`date_end` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `log_photos` ADD `album_id` integer REFERENCES albums(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `log_photos_album_id_idx` ON `log_photos` (`album_id`);