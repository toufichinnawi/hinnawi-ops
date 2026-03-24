ALTER TABLE `recipes` RENAME COLUMN `menuPrice` TO `sellingPrice`;--> statement-breakpoint
ALTER TABLE `recipeIngredients` MODIFY COLUMN `inventoryItemId` int;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `purchaseAmount` decimal(10,3);--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `purchaseCost` decimal(10,2);--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `yieldPct` decimal(5,1) DEFAULT '100.0';--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `costPerUsableUnit` decimal(10,4) DEFAULT '0.0000';--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `supplierName` varchar(256);--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `inventoryItems` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `recipeIngredients` ADD `ingredientName` varchar(256) NOT NULL;--> statement-breakpoint
ALTER TABLE `recipeIngredients` ADD `usableUnitCost` decimal(10,4);--> statement-breakpoint
ALTER TABLE `recipeIngredients` ADD `lineCost` decimal(10,4);--> statement-breakpoint
ALTER TABLE `recipes` ADD `profit` decimal(10,4);--> statement-breakpoint
ALTER TABLE `recipes` ADD `isSubRecipe` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `recipes` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `recipeIngredients` DROP COLUMN `cost`;--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `costPerUnit`;