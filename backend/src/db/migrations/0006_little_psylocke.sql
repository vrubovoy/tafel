CREATE TABLE `notification_occurrences` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `notification_occurrences` (`dedupe_key`, `created_at`)
SELECT `dedupe_key`, `created_at` FROM `notification_outbox`;
