CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`week_starts_on` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#f59e0b' NOT NULL,
	`icon` text DEFAULT 'folder' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `__new_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `__new_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `__new_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status_id` text NOT NULL,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`recurrence_interval` text,
	`recurrence_count` integer,
	`recurrence_anchor_date` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `__new_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `__new_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `__new_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_task_id`) REFERENCES `__new_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `email`, `name`, `week_starts_on`, `created_at`)
SELECT `id`, `email`, `name`, `week_starts_on`, `created_at` FROM `users`;
--> statement-breakpoint
INSERT INTO `__new_projects` (`id`, `user_id`, `name`, `color`, `icon`, `sort_order`, `archived`, `created_at`)
SELECT `id`, `user_id`, `name`, `color`, `icon`, `sort_order`, `archived`, `created_at` FROM `projects`;
--> statement-breakpoint
INSERT INTO `__new_statuses` (`id`, `project_id`, `name`, `color`, `sort_order`, `is_done`, `created_at`)
SELECT `id`, `project_id`, `name`, `color`, `sort_order`, `is_done`, `created_at` FROM `statuses`;
--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `user_id`, `project_id`, `status_id`, `parent_task_id`, `title`, `description`, `priority`, `due_date`, `sort_order`, `completed_at`, `recurrence_interval`, `recurrence_count`, `recurrence_anchor_date`, `archived`, `created_at`)
SELECT `id`, `user_id`, `project_id`, `status_id`, `parent_task_id`, `title`, `description`, `priority`, `due_date`, `sort_order`, `completed_at`, `recurrence_interval`, `recurrence_count`, `recurrence_anchor_date`, `archived`, `created_at` FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
DROP TABLE `statuses`;
--> statement-breakpoint
DROP TABLE `projects`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;
--> statement-breakpoint
ALTER TABLE `__new_statuses` RENAME TO `statuses`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
