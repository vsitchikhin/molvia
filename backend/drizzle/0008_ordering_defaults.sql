ALTER TABLE "expenses" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "started_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "verdicts" ALTER COLUMN "rated_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "verdicts" ALTER COLUMN "updated_at" SET DEFAULT clock_timestamp();