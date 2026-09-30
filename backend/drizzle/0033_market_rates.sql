CREATE TABLE "market_rates" (
	"channel" text NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"side" text NOT NULL,
	"scaled" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_rates_channel_currency_side_rate_date_pk" PRIMARY KEY("channel","currency","side","rate_date"),
	CONSTRAINT "market_rates_channel_known" CHECK ("market_rates"."channel" in ('bankCash', 'bankNoncash', 'banksAll', 'exchanger')),
	CONSTRAINT "market_rates_side_known" CHECK ("market_rates"."side" in ('bankBuys', 'bankSells')),
	CONSTRAINT "market_rates_currency_foreign" CHECK ("market_rates"."currency" in ('AMD', 'RUB', 'USD', 'EUR') and "market_rates"."currency" <> 'AMD'),
	CONSTRAINT "market_rates_positive" CHECK ("market_rates"."scaled" > 0)
);
--> statement-breakpoint
ALTER TABLE "exchange_revisions" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "exchange_revisions" ADD CONSTRAINT "exchange_revisions_channel_known" CHECK ("exchange_revisions"."channel" is null or "exchange_revisions"."channel" in ('bankCash', 'bankNoncash', 'exchanger'));--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_channel_known" CHECK ("exchanges"."channel" is null or "exchanges"."channel" in ('bankCash', 'bankNoncash', 'exchanger'));