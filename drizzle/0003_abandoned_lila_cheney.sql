CREATE TABLE `modulePolicies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`unitId` int NOT NULL,
	`role` enum('owner','admin','manager','professional','viewer') NOT NULL,
	`module` varchar(64) NOT NULL,
	`canView` int NOT NULL DEFAULT 1,
	`canManage` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulePolicies_id` PRIMARY KEY(`id`),
	CONSTRAINT `module_policies_scope_idx` UNIQUE(`organizationId`,`unitId`,`role`,`module`)
);
--> statement-breakpoint
CREATE TABLE `onboardingProgress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`currentStep` int NOT NULL DEFAULT 1,
	`status` enum('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
	`city` varchar(120),
	`defaultUnitName` varchar(160),
	`inviteEmail` varchar(320),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onboardingProgress_id` PRIMARY KEY(`id`),
	CONSTRAINT `onboardingProgress_organizationId_unique` UNIQUE(`organizationId`)
);
--> statement-breakpoint
CREATE TABLE `organizationUnits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`city` varchar(120),
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationUnits_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_units_org_slug_idx` UNIQUE(`organizationId`,`slug`)
);
