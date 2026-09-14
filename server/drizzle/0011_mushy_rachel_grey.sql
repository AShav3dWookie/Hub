CREATE TABLE `notification_deliveries` (
	`slot` text NOT NULL,
	`fired_on` text NOT NULL,
	`item_key` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_slot_fired_on_item_key_idx` ON `notification_deliveries` (`slot`,`fired_on`,`item_key`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`last_success_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);