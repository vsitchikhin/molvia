ALTER TABLE "receipts" ADD COLUMN "cashback_minor" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "redeemed_minor" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cashback_positive" CHECK ("receipts"."cashback_minor" is null or "receipts"."cashback_minor" > 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_redeemed_positive" CHECK ("receipts"."redeemed_minor" is null or "receipts"."redeemed_minor" > 0);