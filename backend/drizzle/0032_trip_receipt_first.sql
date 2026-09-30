ALTER TABLE "trips" ADD COLUMN "receipt_first_at" timestamp with time zone;--> statement-breakpoint
-- A sum written by 0031 alone was first typed no later than it last changed.
UPDATE "trips" SET "receipt_first_at" = "receipt_set_at" WHERE "receipt_minor" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_receipt_first_with_sum" CHECK (("trips"."receipt_minor" is null) = ("trips"."receipt_first_at" is null));
