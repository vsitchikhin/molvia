CREATE TABLE "brand_spellings" (
	"brand" text PRIMARY KEY NOT NULL,
	"spelling" text,
	"said" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "brand_spellings_brand_armenian" CHECK ("brand_spellings"."brand" ~ '[ա-ֆ]'),
	CONSTRAINT "brand_spellings_spelling_short" CHECK (char_length("brand_spellings"."spelling") <= 40)
);
