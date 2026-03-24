ALTER TABLE `invoices` ADD `fileUrl` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `fileKey` varchar(512);--> statement-breakpoint
ALTER TABLE `invoices` ADD `deliveryNoteUrl` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deliveryNoteKey` varchar(512);--> statement-breakpoint
ALTER TABLE `invoices` ADD `autoApproved` boolean DEFAULT false;