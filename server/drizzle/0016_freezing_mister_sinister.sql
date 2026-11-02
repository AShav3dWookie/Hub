CREATE TABLE `voice_commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_token_id` integer,
	`action` text NOT NULL,
	`created` text NOT NULL,
	`created_at` text NOT NULL,
	`undone_at` text,
	FOREIGN KEY (`device_token_id`) REFERENCES `device_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
