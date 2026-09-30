ALTER TABLE "trips" ADD COLUMN "receipt_minor" bigint;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "receipt_currency" char(3);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "receipt_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_receipt_whole" CHECK (num_nonnulls("trips"."receipt_minor", "trips"."receipt_currency") in (0, 2)
        and ("trips"."receipt_minor" is null or ("trips"."receipt_minor" > 0 and "trips"."receipt_set_at" is not null)));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_receipt_currency_known" CHECK ("trips"."receipt_currency" is null or "trips"."receipt_currency" in ('AMD', 'RUB', 'USD', 'EUR'));