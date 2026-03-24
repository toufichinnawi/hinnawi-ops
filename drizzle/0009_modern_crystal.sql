CREATE TABLE `bankAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`bankName` varchar(128),
	`accountNumber` varchar(64),
	`locationId` int NOT NULL,
	`accountType` enum('checking','savings','credit_card') DEFAULT 'checking',
	`currency` varchar(3) DEFAULT 'CAD',
	`qboAccountId` varchar(64),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bankAccounts_id` PRIMARY KEY(`id`)
);
