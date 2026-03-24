CREATE TABLE `bankTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountName` varchar(256),
	`transactionDate` date NOT NULL,
	`description` varchar(512),
	`debit` decimal(12,2) DEFAULT '0.00',
	`credit` decimal(12,2) DEFAULT '0.00',
	`balance` decimal(14,2),
	`category` varchar(128),
	`matchedType` enum('unmatched','sales_deposit','payroll','supplier_payment','intercompany','tax_payment','loan','other') DEFAULT 'unmatched',
	`matchedRecordId` int,
	`locationId` int,
	`importLogId` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bankTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `importLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`importType` enum('pos_sales','payroll','bank_statement','invoices') NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`fileUrl` text,
	`status` enum('pending','processing','completed','failed') DEFAULT 'pending',
	`recordsFound` int DEFAULT 0,
	`recordsImported` int DEFAULT 0,
	`recordsSkipped` int DEFAULT 0,
	`recordsFailed` int DEFAULT 0,
	`locationId` int,
	`dateRangeStart` date,
	`dateRangeEnd` date,
	`errors` json,
	`importedBy` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `importLogs_id` PRIMARY KEY(`id`)
);
