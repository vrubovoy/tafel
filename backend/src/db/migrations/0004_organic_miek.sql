ALTER TABLE `tasks` ADD `recurrence_series_id` text;
--> statement-breakpoint
UPDATE `tasks` SET `recurrence_series_id` = `id` WHERE `recurrence_interval` IS NOT NULL;
