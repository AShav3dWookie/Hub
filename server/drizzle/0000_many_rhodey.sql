CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entities_category_normalized_title_idx` ON `entities` (`category`,`normalized_title`);--> statement-breakpoint
CREATE TABLE `log_people` (
	`log_id` integer NOT NULL,
	`person_entity_id` integer NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_people_log_id_person_entity_id_idx` ON `log_people` (`log_id`,`person_entity_id`);--> statement-breakpoint
CREATE INDEX `log_people_person_entity_id_idx` ON `log_people` (`person_entity_id`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_id` integer NOT NULL,
	`rating` integer,
	`date` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `logs_entity_id_idx` ON `logs` (`entity_id`);--> statement-breakpoint
CREATE INDEX `logs_date_idx` ON `logs` (`date`);