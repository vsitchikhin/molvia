-- What a receipt line is and where it goes (MOL-126): the catalogue's names in the tills' languages and
-- the customs headings an item is sold under (written by the seed), a receipt to the one trip it was
-- recorded as, the shop's shared memory «tax number + article → item», and a receipt's lines bound to
-- items and recorded as purchases. The memory outlives its author: erasure leaves a word without one.
CREATE TABLE "item_hs" (
	"item_id" uuid NOT NULL,
	"hs" char(4) NOT NULL,
	CONSTRAINT "item_hs_item_id_hs_pk" PRIMARY KEY("item_id","hs"),
	CONSTRAINT "item_hs_four_digits" CHECK ("item_hs"."hs" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "item_names" (
	"item_id" uuid NOT NULL,
	"language" text NOT NULL,
	"name" varchar(200) NOT NULL,
	CONSTRAINT "item_names_item_id_language_name_pk" PRIMARY KEY("item_id","language","name"),
	CONSTRAINT "item_names_language_known" CHECK ("item_names"."language" in ('hy'))
);
--> statement-breakpoint
CREATE TABLE "store_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tin" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"actor_id" uuid,
	"item_id" uuid NOT NULL,
	"price_minor" bigint,
	"price_currency" char(3),
	"written_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "store_memory_kind_known" CHECK ("store_memory"."kind" in ('sku', 'text')),
	CONSTRAINT "store_memory_price_whole" CHECK (("store_memory"."price_minor" is null) = ("store_memory"."price_currency" is null)),
	CONSTRAINT "store_memory_price_non_negative" CHECK ("store_memory"."price_minor" is null or "store_memory"."price_minor" >= 0),
	CONSTRAINT "store_memory_currency_known" CHECK ("store_memory"."price_currency" is null or "store_memory"."price_currency" in ('AMD', 'RUB', 'USD', 'EUR'))
);
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "match" text;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "translation" text;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "item_hs" ADD CONSTRAINT "item_hs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_names" ADD CONSTRAINT "item_names_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memory" ADD CONSTRAINT "store_memory_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memory" ADD CONSTRAINT "store_memory_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_names_language_idx" ON "item_names" USING btree ("language");--> statement-breakpoint
CREATE UNIQUE INDEX "store_memory_word_key" ON "store_memory" USING btree ("tin","kind","key","actor_id");--> statement-breakpoint
CREATE INDEX "store_memory_actor_idx" ON "store_memory" USING btree ("actor_id");--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_lines_expense_key" ON "receipt_lines" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_trip_key" ON "receipts" USING btree ("trip_id") WHERE "receipts"."trip_id" is not null;--> statement-breakpoint
CREATE INDEX "receipts_recorded_tin_idx" ON "receipts" USING btree ("tin") WHERE "receipts"."status" = 'recorded';--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_match_known" CHECK ("receipt_lines"."match" is null or "receipt_lines"."match" in ('search', 'weak', 'new'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_city_known" CHECK ("receipts"."city" is null or "receipts"."city" in ('Гюмри', 'Ереван'));