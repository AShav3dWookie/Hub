CREATE TABLE `server_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE INDEX `server_logs_at_idx` ON `server_logs` (`at`);--> statement-breakpoint
ALTER TABLE `device_tokens` ADD `scope` text DEFAULT 'device' NOT NULL;