ALTER TABLE `invoices` ADD `qboSyncStatus` enum('not_synced','pending','synced','failed') DEFAULT 'not_synced';--> statement-breakpoint
ALTER TABLE `invoices` ADD `qboSyncError` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `qboSyncedAt` timestamp;