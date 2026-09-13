CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_milli" bigint,
	"qty_unit" text,
	"amount_minor" bigint,
	"amount_currency" char(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_quantity_paired" CHECK (("expenses"."qty_milli" is null) = ("expenses"."qty_unit" is null)),
	CONSTRAINT "expenses_quantity_positive" CHECK ("expenses"."qty_milli" is null or "expenses"."qty_milli" > 0),
	CONSTRAINT "expenses_quantity_unit_known" CHECK ("expenses"."qty_unit" is null or "expenses"."qty_unit" in ('kg', 'l', 'piece')),
	CONSTRAINT "expenses_quantity_whole_pieces" CHECK ("expenses"."qty_unit" is distinct from 'piece' or "expenses"."qty_milli" % 1000 = 0),
	CONSTRAINT "expenses_amount_paired" CHECK (("expenses"."amount_minor" is null) = ("expenses"."amount_currency" is null)),
	CONSTRAINT "expenses_amount_not_negative" CHECK ("expenses"."amount_minor" is null or "expenses"."amount_minor" >= 0),
	CONSTRAINT "expenses_amount_currency_known" CHECK ("expenses"."amount_currency" is null or "expenses"."amount_currency" in ('AMD', 'RUB', 'USD', 'EUR'))
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"country" char(2) NOT NULL,
	"city" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_kind_country_city_name_key" UNIQUE("kind","country","city","name"),
	CONSTRAINT "places_kind_known" CHECK ("places"."kind" in ('store', 'venue')),
	CONSTRAINT "places_country_iso" CHECK ("places"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_base" char(3),
	"rate_quote" char(3),
	"rate_scaled" bigint,
	"rate_source" text,
	"rate_as_of" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "trips_currency_known" CHECK ("trips"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "trips_rate_all_or_none" CHECK (num_nonnulls("trips"."rate_base", "trips"."rate_quote", "trips"."rate_scaled", "trips"."rate_source", "trips"."rate_as_of") in (0, 5)),
	CONSTRAINT "trips_rate_quote_is_trip_currency" CHECK ("trips"."rate_quote" is null or "trips"."rate_quote" = "trips"."currency"),
	CONSTRAINT "trips_rate_two_currencies" CHECK ("trips"."rate_base" is null or "trips"."rate_base" <> "trips"."rate_quote"),
	CONSTRAINT "trips_rate_base_known" CHECK ("trips"."rate_base" is null or "trips"."rate_base" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "trips_rate_quote_known" CHECK ("trips"."rate_quote" is null or "trips"."rate_quote" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "trips_rate_source_known" CHECK ("trips"."rate_source" is null or "trips"."rate_source" in ('personal', 'official')),
	CONSTRAINT "trips_finished_after_start" CHECK ("trips"."finished_at" is null or "trips"."finished_at" >= "trips"."started_at")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_trip_idx" ON "expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "expenses_item_idx" ON "expenses" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "trips_actor_started_idx" ON "trips" USING btree ("actor_id","started_at");