CREATE TABLE "open_food_facts" (
	"code" varchar(14) PRIMARY KEY NOT NULL,
	"found" boolean NOT NULL,
	"name_ru" varchar(200),
	"name_en" varchar(200),
	"quantity_milli" bigint,
	"quantity_unit" text,
	"fetched_on" date DEFAULT current_date NOT NULL,
	CONSTRAINT "open_food_facts_gtin_shape" CHECK ("open_food_facts"."code" ~ '^([0-9]{8}|[0-9]{12,14})$'),
	CONSTRAINT "open_food_facts_names_found" CHECK ("open_food_facts"."found" = ("open_food_facts"."name_ru" is not null) and "open_food_facts"."found" = ("open_food_facts"."name_en" is not null)),
	CONSTRAINT "open_food_facts_quantity_paired" CHECK (("open_food_facts"."quantity_milli" is null) = ("open_food_facts"."quantity_unit" is null)),
	CONSTRAINT "open_food_facts_quantity_found" CHECK ("open_food_facts"."found" or "open_food_facts"."quantity_milli" is null),
	CONSTRAINT "open_food_facts_quantity_positive" CHECK ("open_food_facts"."quantity_milli" is null or "open_food_facts"."quantity_milli" > 0),
	CONSTRAINT "open_food_facts_quantity_unit" CHECK ("open_food_facts"."quantity_unit" is null or "open_food_facts"."quantity_unit" in ('kg', 'l'))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_origin_known" CHECK ("items"."origin" is null or "items"."origin" in ('open_food_facts'));