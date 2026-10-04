ALTER TABLE "actors" ADD COLUMN "receipt_notices_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "heard" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "heard_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "receipts_untold_idx" ON "receipts" USING btree ("read_at") WHERE "receipts"."status" in ('parsed', 'failed') and "receipts"."heard" is null and "receipts"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_heard_known" CHECK ("receipts"."heard" is null or "receipts"."heard" in ('app', 'bot'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_heard_when" CHECK (("receipts"."heard" is null) = ("receipts"."heard_at" is null));