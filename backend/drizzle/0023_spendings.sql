CREATE TABLE "money_month_rates" (
	"actor_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"scaled" bigint NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "money_month_rates_actor_id_month_base_quote_pk" PRIMARY KEY("actor_id","month","base","quote"),
	CONSTRAINT "money_month_rates_two_currencies" CHECK ("money_month_rates"."base" <> "money_month_rates"."quote"),
	CONSTRAINT "money_month_rates_base_known" CHECK ("money_month_rates"."base" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "money_month_rates_quote_known" CHECK ("money_month_rates"."quote" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "money_month_rates_source_known" CHECK ("money_month_rates"."source" in ('personal', 'official', 'fallback')),
	CONSTRAINT "money_month_rates_month_shape" CHECK ("money_month_rates"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "spending_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"preset" text,
	"name" text,
	"colour" smallint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "spending_categories_id_actor_unique" UNIQUE("id","actor_id"),
	CONSTRAINT "spending_categories_preset_or_own" CHECK (("spending_categories"."preset" is not null and "spending_categories"."name" is null and "spending_categories"."colour" is null)
        or ("spending_categories"."preset" is null and "spending_categories"."name" is not null and "spending_categories"."colour" is not null)),
	CONSTRAINT "spending_categories_preset_known" CHECK ("spending_categories"."preset" is null or "spending_categories"."preset" in ('groceries', 'cafe', 'rent', 'home', 'beauty', 'transport', 'telecom', 'health', 'clothes', 'pets', 'leisure', 'documents', 'other')),
	CONSTRAINT "spending_categories_colour_in_palette" CHECK ("spending_categories"."colour" is null or "spending_categories"."colour" between 0 and 7)
);
--> statement-breakpoint
CREATE TABLE "spendings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"category_id" uuid NOT NULL,
	"note" text,
	"place" text,
	"rate_base" char(3),
	"rate_quote" char(3),
	"rate_scaled" bigint,
	"rate_source" text,
	"rate_as_of" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"amended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "spendings_amount_positive" CHECK ("spendings"."amount_minor" > 0),
	CONSTRAINT "spendings_currency_known" CHECK ("spendings"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "spendings_revision_positive" CHECK ("spendings"."revision" > 0),
	CONSTRAINT "spendings_rate_all_or_none" CHECK (num_nonnulls("spendings"."rate_base", "spendings"."rate_quote", "spendings"."rate_scaled", "spendings"."rate_source", "spendings"."rate_as_of") in (0, 5)),
	CONSTRAINT "spendings_rate_base_is_spending_currency" CHECK ("spendings"."rate_base" is null or "spendings"."rate_base" = "spendings"."currency"),
	CONSTRAINT "spendings_rate_two_currencies" CHECK ("spendings"."rate_base" is null or "spendings"."rate_base" <> "spendings"."rate_quote"),
	CONSTRAINT "spendings_rate_quote_known" CHECK ("spendings"."rate_quote" is null or "spendings"."rate_quote" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "spendings_rate_source_known" CHECK ("spendings"."rate_source" is null or "spendings"."rate_source" in ('personal', 'official', 'fallback'))
);
--> statement-breakpoint
ALTER TABLE "money_month_rates" ADD CONSTRAINT "money_month_rates_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_categories" ADD CONSTRAINT "spending_categories_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_category_is_owners" FOREIGN KEY ("category_id","actor_id") REFERENCES "public"."spending_categories"("id","actor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spending_categories_actor_preset_unique" ON "spending_categories" USING btree ("actor_id","preset") WHERE "spending_categories"."preset" is not null;--> statement-breakpoint
CREATE INDEX "spendings_actor_day_idx" ON "spendings" USING btree ("actor_id","spent_on","created_at");