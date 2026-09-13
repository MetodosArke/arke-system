ALTER TABLE `organizations` MODIFY COLUMN `plan` enum('starter','growth','scale','unlimited','essencial','performance','premium') NOT NULL DEFAULT 'starter';--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `plan` enum('starter','growth','scale','unlimited','essencial','performance','premium') NOT NULL;--> statement-breakpoint
