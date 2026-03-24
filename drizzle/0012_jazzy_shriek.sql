CREATE TABLE `quotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quotationNumber` varchar(64),
	`supplierId` int,
	`locationId` int,
	`quotationDate` date,
	`expiryDate` date,
	`subtotal` decimal(12,2) DEFAULT '0.00',
	`gst` decimal(10,2) DEFAULT '0.00',
	`qst` decimal(10,2) DEFAULT '0.00',
	`total` decimal(12,2) DEFAULT '0.00',
	`quotation_status` enum('draft','pending_advance','advance_paid','converted','expired','rejected') DEFAULT 'draft',
	`advanceRequired` boolean DEFAULT false,
	`advanceAmount` decimal(12,2) DEFAULT '0.00',
	`advancePaidAt` timestamp,
	`advancePaymentRef` varchar(128),
	`advancePaidStatus` enum('not_required','unpaid','paid') DEFAULT 'not_required',
	`convertedInvoiceId` int,
	`glAccount` varchar(128),
	`notes` text,
	`fileUrl` text,
	`fileKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `quotationId` int;