ALTER TABLE `tasks` ADD `archived_by_project` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `tasks`
SET `archived` = true, `archived_by_project` = true
WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `archived` = true);
