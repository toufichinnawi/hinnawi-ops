ALTER TABLE `dailySales` ADD `labourCost` decimal(12,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `dailySales` ADD `orderCount` int DEFAULT 0;