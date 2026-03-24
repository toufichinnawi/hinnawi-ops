CREATE TABLE `productSales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationId` int NOT NULL,
	`periodStart` date NOT NULL,
	`periodEnd` date NOT NULL,
	`section` enum('items','options') NOT NULL DEFAULT 'items',
	`itemName` varchar(256) NOT NULL,
	`category` varchar(128),
	`groupName` varchar(128),
	`totalRevenue` decimal(12,2) DEFAULT '0.00',
	`quantitySold` int DEFAULT 0,
	`quantityRefunded` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `productSales_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `importLogs` MODIFY COLUMN `importType` enum('pos_sales','payroll','bank_statement','invoices','product_sales') NOT NULL;