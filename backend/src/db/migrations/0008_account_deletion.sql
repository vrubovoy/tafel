CREATE TABLE `deletion_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_tombstones` (
	`user_id` text PRIMARY KEY NOT NULL,
	`deletion_job_id` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_tombstones_deletion_job_id_unique` ON `user_tombstones` (`deletion_job_id`);