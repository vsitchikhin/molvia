CREATE TABLE "official_rates" (
	"provider" text NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"scaled" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_rates_provider_currency_rate_date_pk" PRIMARY KEY("provider","currency","rate_date"),
	CONSTRAINT "official_rates_provider_known" CHECK ("official_rates"."provider" in ('cba', 'cbr', 'erapi')),
	CONSTRAINT "official_rates_currency_foreign" CHECK ("official_rates"."currency" in ('AMD', 'RUB', 'USD', 'EUR') and "official_rates"."currency" <> 'AMD'),
	CONSTRAINT "official_rates_positive" CHECK ("official_rates"."scaled" > 0)
);
--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_source_known";--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_source_known" CHECK ("trips"."rate_source" is null or "trips"."rate_source" in ('personal', 'official', 'fallback'));