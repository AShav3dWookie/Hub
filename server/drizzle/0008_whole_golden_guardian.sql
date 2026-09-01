CREATE TABLE `sync_applied_mutations` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
