ALTER TABLE `entities` ADD `release_year` integer;--> statement-breakpoint
ALTER TABLE `entities` ADD `author` text;--> statement-breakpoint
ALTER TABLE `entity_notes` ADD `tag` text;--> statement-breakpoint
ALTER TABLE `entity_notes` ADD `event_date` text;--> statement-breakpoint
UPDATE `entities` SET `category` = 'eating_out' WHERE `category` = 'restaurant';