ALTER TABLE "trips" ADD COLUMN "rate_previous_scaled" bigint;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_previous_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_choice" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_previous_whole" CHECK (num_nonnulls("trips"."rate_previous_scaled", "trips"."rate_previous_as_of") in (0, 2));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_previous_needs_rate" CHECK ("trips"."rate_previous_scaled" is null or "trips"."rate_scaled" is not null);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_previous_positive" CHECK ("trips"."rate_previous_scaled" is null or "trips"."rate_previous_scaled" > 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_choice_known" CHECK ("trips"."rate_choice" is null or "trips"."rate_choice" in ('jumped', 'previous'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_choice_needs_previous" CHECK ("trips"."rate_choice" is null or "trips"."rate_previous_scaled" is not null);