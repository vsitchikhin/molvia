CREATE TABLE "official_rates" (
	"provider" text NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"scaled" bigint NOT NULL,
	"jump" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_rates_provider_currency_rate_date_pk" PRIMARY KEY("provider","currency","rate_date"),
	CONSTRAINT "official_rates_provider_known" CHECK ("official_rates"."provider" in ('cba', 'cbr', 'erapi')),
	CONSTRAINT "official_rates_currency_foreign" CHECK ("official_rates"."currency" in ('AMD', 'RUB', 'USD', 'EUR') and "official_rates"."currency" <> 'AMD'),
	CONSTRAINT "official_rates_positive" CHECK ("official_rates"."scaled" > 0)
);
--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_source_known";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_jumped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_previous_scaled" bigint;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_previous_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_manual_scaled" bigint;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_manual_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rate_choice" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_jumped_needs_rate" CHECK (not "trips"."rate_jumped" or "trips"."rate_scaled" is not null);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_previous_whole" CHECK (num_nonnulls("trips"."rate_previous_scaled", "trips"."rate_previous_as_of") in (0, 2));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_previous_needs_jump" CHECK ("trips"."rate_previous_scaled" is null or ("trips"."rate_jumped" and "trips"."rate_previous_scaled" > 0));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_manual_whole" CHECK (num_nonnulls("trips"."rate_manual_scaled", "trips"."rate_manual_as_of") in (0, 2));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_manual_needs_jump" CHECK ("trips"."rate_manual_scaled" is null or ("trips"."rate_jumped" and "trips"."rate_manual_scaled" > 0));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_choice_known" CHECK ("trips"."rate_choice" is null or "trips"."rate_choice" in ('jumped', 'previous', 'manual'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_choice_held" CHECK ("trips"."rate_choice" is null or ("trips"."rate_jumped" and ("trips"."rate_choice" <> 'previous' or "trips"."rate_previous_scaled" is not null) and ("trips"."rate_choice" <> 'manual' or "trips"."rate_manual_scaled" is not null)));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_source_known" CHECK ("trips"."rate_source" is null or "trips"."rate_source" in ('personal', 'official', 'fallback'));