CREATE TABLE `ingredientPriceHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inventoryItemId` int NOT NULL,
	`invoiceId` int,
	`invoiceLineItemId` int,
	`supplierId` int,
	`previousCostPerUnit` decimal(10,4),
	`newCostPerUnit` decimal(10,4) NOT NULL,
	`previousCostPerUsableUnit` decimal(10,4),
	`newCostPerUsableUnit` decimal(10,4) NOT NULL,
	`changePercent` decimal(8,2),
	`quantity` decimal(10,3),
	`unit` varchar(32),
	`priceSource` enum('invoice','manual','email_extraction','import') NOT NULL DEFAULT 'invoice',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ingredientPriceHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoiceLineItemMatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceLineItemId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`inventoryItemId` int,
	`lineDescription` varchar(512),
	`matchedItemName` varchar(256),
	`confidence` decimal(5,2),
	`matchMethod` enum('exact','fuzzy','ai','manual') DEFAULT 'ai',
	`matchStatus` enum('auto_matched','confirmed','rejected','unmatched') DEFAULT 'auto_matched',
	`unitPrice` decimal(10,4),
	`quantity` decimal(10,3),
	`unit` varchar(32),
	`priceApplied` boolean DEFAULT false,
	`reviewedBy` varchar(256),
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoiceLineItemMatches_id` PRIMARY KEY(`id`)
);
