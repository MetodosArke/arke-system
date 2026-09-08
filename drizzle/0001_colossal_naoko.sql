CREATE TABLE `invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`invitedByUserId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','manager','professional','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('pending','accepted','expired','revoked') NOT NULL DEFAULT 'pending',
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','manager','professional','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('active','invited','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_org_user_idx` UNIQUE(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`plan` enum('starter','growth','scale') NOT NULL DEFAULT 'starter',
	`status` enum('trial','active','past_due','canceled') NOT NULL DEFAULT 'trial',
	`logoUrl` varchar(512),
	`primaryColor` varchar(32) NOT NULL DEFAULT '#c99518',
	`maxUnits` int NOT NULL DEFAULT 1,
	`maxUsers` int NOT NULL DEFAULT 12,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `organizations_slug_idx` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`plan` enum('starter','growth','scale') NOT NULL,
	`status` enum('trialing','active','past_due','canceled') NOT NULL DEFAULT 'trialing',
	`billingCycle` enum('monthly','yearly') NOT NULL DEFAULT 'monthly',
	`amountCents` int NOT NULL DEFAULT 0,
	`provider` varchar(32) NOT NULL DEFAULT 'sandbox',
	`externalRef` varchar(180),
	`renewsAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
