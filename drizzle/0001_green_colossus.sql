CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('inventory','labor','invoice','receiving','system') DEFAULT 'system',
	`severity` enum('urgent','medium','low') DEFAULT 'medium',
	`title` varchar(256) NOT NULL,
	`description` text,
	`locationId` int,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dailySales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationId` int NOT NULL,
	`saleDate` date NOT NULL,
	`taxExemptSales` decimal(12,2) DEFAULT '0.00',
	`taxableSales` decimal(12,2) DEFAULT '0.00',
	`totalSales` decimal(12,2) DEFAULT '0.00',
	`gstCollected` decimal(10,2) DEFAULT '0.00',
	`qstCollected` decimal(10,2) DEFAULT '0.00',
	`totalDeposit` decimal(12,2) DEFAULT '0.00',
	`tipsCollected` decimal(10,2) DEFAULT '0.00',
	`merchantFees` decimal(10,2) DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dailySales_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`type` varchar(32) NOT NULL,
	`status` enum('live','syncing','error','disconnected') DEFAULT 'disconnected',
	`lastSyncAt` timestamp,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventoryItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemCode` varchar(64),
	`name` varchar(256) NOT NULL,
	`category` varchar(128),
	`unit` varchar(32),
	`avgCost` decimal(10,4) DEFAULT '0.0000',
	`lastCost` decimal(10,4) DEFAULT '0.0000',
	`parLevel` decimal(10,2),
	`supplierId` int,
	`cogsAccount` varchar(128),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventoryItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoiceLineItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`productCode` varchar(64),
	`description` varchar(512),
	`quantity` decimal(10,3) DEFAULT '0.000',
	`unitPrice` decimal(10,4) DEFAULT '0.0000',
	`amount` decimal(12,2) DEFAULT '0.00',
	`glAccount` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoiceLineItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNumber` varchar(64),
	`supplierId` int,
	`locationId` int,
	`invoiceDate` date,
	`dueDate` date,
	`subtotal` decimal(12,2) DEFAULT '0.00',
	`gst` decimal(10,2) DEFAULT '0.00',
	`qst` decimal(10,2) DEFAULT '0.00',
	`total` decimal(12,2) DEFAULT '0.00',
	`status` enum('pending','approved','paid','rejected') DEFAULT 'pending',
	`glAccount` varchar(128),
	`qboSynced` boolean DEFAULT false,
	`qboBillId` varchar(64),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(10) NOT NULL,
	`name` varchar(128) NOT NULL,
	`entityName` varchar(256),
	`address` text,
	`laborTarget` decimal(5,2) DEFAULT '25.00',
	`foodCostTarget` decimal(5,2) DEFAULT '30.00',
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `payrollRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationId` int NOT NULL,
	`payDate` date NOT NULL,
	`periodStart` date,
	`periodEnd` date,
	`grossWages` decimal(12,2) DEFAULT '0.00',
	`employerContributions` decimal(10,2) DEFAULT '0.00',
	`netPayroll` decimal(12,2) DEFAULT '0.00',
	`headcount` int DEFAULT 0,
	`totalHours` decimal(10,2) DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payrollRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `poLineItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`inventoryItemId` int,
	`description` varchar(512),
	`quantity` decimal(10,3) DEFAULT '0.000',
	`unitPrice` decimal(10,4) DEFAULT '0.0000',
	`receivedQty` decimal(10,3),
	`variance` decimal(10,3),
	`amount` decimal(12,2) DEFAULT '0.00',
	CONSTRAINT `poLineItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchaseOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poNumber` varchar(32),
	`supplierId` int NOT NULL,
	`locationId` int NOT NULL,
	`status` enum('draft','submitted','received','cancelled') DEFAULT 'draft',
	`orderDate` date,
	`expectedDate` date,
	`subtotal` decimal(12,2) DEFAULT '0.00',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchaseOrders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipeIngredients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipeId` int NOT NULL,
	`inventoryItemId` int NOT NULL,
	`quantity` decimal(10,4) NOT NULL,
	`unit` varchar(32),
	`cost` decimal(10,4),
	CONSTRAINT `recipeIngredients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`category` varchar(128),
	`yield` decimal(10,2) DEFAULT '1.00',
	`yieldUnit` varchar(32),
	`menuPrice` decimal(10,2),
	`totalCost` decimal(10,4),
	`costPerUnit` decimal(10,4),
	`foodCostPct` decimal(5,2),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recipes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`code` varchar(32),
	`contactEmail` varchar(320),
	`phone` varchar(32),
	`address` text,
	`category` varchar(64),
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`)
);
