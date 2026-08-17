ALTER TABLE `notification_outbox` ADD `permanent_at` integer;
--> statement-breakpoint
UPDATE `notification_outbox`
SET `permanent_at` = CAST(strftime('%s', 'now') AS integer) * 1000
WHERE `state` = 'permanent' AND `permanent_at` IS NULL;
