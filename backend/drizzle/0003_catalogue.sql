-- Правка руками: drizzle-kit не знает про расширения, а поиск стоит на них.
-- MOL-10 ранжирует минимальным расстоянием Левенштейна по словам, и levenshtein живёт
-- в fuzzystrmatch. Миграция 0000 включила только pg_trgm и unaccent, хотя CLAUDE.md
-- и онбординг утверждали обратное — утверждение правится вместе с этим коммитом.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;--> statement-breakpoint
CREATE TABLE "item_barcodes" (
	"code" varchar(14) PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "item_barcodes_gtin_shape" CHECK ("item_barcodes"."code" ~ '^([0-9]{8}|[0-9]{12,14})$')
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"search_key" varchar(800) NOT NULL,
	"note" varchar(300),
	"default_unit" text NOT NULL,
	"typical_qty_milli" bigint,
	"typical_qty_unit" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_kind_known" CHECK ("items"."kind" in ('product', 'dish')),
	CONSTRAINT "items_default_unit_known" CHECK ("items"."default_unit" in ('kg', 'l', 'piece')),
	CONSTRAINT "items_typical_quantity_paired" CHECK (("items"."typical_qty_milli" is null) = ("items"."typical_qty_unit" is null)),
	CONSTRAINT "items_typical_quantity_positive" CHECK ("items"."typical_qty_milli" is null or "items"."typical_qty_milli" > 0),
	CONSTRAINT "items_typical_quantity_unit_known" CHECK ("items"."typical_qty_unit" is null or "items"."typical_qty_unit" in ('kg', 'l', 'piece')),
	CONSTRAINT "items_typical_quantity_whole_pieces" CHECK ("items"."typical_qty_unit" is distinct from 'piece' or "items"."typical_qty_milli" % 1000 = 0)
);
--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_actors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_barcodes_item_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_search_key_trgm_idx" ON "items" USING gin ("search_key" gin_trgm_ops);