-- Receipts read on our server (MOL-125): the receipt, its photo part by part, the lines the reader
-- laid it out into, and the item lines cut out for retraining the reader (MOL-169). The photos and
-- the cut-out lines carry a customer's name or what was bought, so the nightly copy leaves their
-- data out (В-2, deploy/backup); erasure takes all four through `receipts`.
CREATE TABLE "receipt_line_images" (
	"receipt_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"piece" smallint NOT NULL,
	"image" "bytea" NOT NULL,
	"read_text" text NOT NULL,
	"confirmed_text" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receipt_line_images_receipt_id_position_piece_pk" PRIMARY KEY("receipt_id","position","piece"),
	CONSTRAINT "receipt_line_images_piece_range" CHECK ("receipt_line_images"."piece" between 0 and 3),
	CONSTRAINT "receipt_line_images_confirmed_whole" CHECK (("receipt_line_images"."confirmed_text" is null) = ("receipt_line_images"."confirmed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"receipt_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"printed" text NOT NULL,
	"hs" text,
	"sku" text,
	"qty_milli" bigint,
	"qty_unit" text,
	"price_minor" bigint,
	"sum_minor" bigint,
	"discount_minor" bigint,
	"settled" boolean NOT NULL,
	CONSTRAINT "receipt_lines_receipt_id_position_pk" PRIMARY KEY("receipt_id","position"),
	CONSTRAINT "receipt_lines_position_non_negative" CHECK ("receipt_lines"."position" >= 0),
	CONSTRAINT "receipt_lines_quantity_whole" CHECK (("receipt_lines"."qty_milli" is null) = ("receipt_lines"."qty_unit" is null)),
	CONSTRAINT "receipt_lines_quantity_positive" CHECK ("receipt_lines"."qty_milli" is null or "receipt_lines"."qty_milli" > 0),
	CONSTRAINT "receipt_lines_unit_known" CHECK ("receipt_lines"."qty_unit" is null or "receipt_lines"."qty_unit" in ('kg', 'l', 'piece')),
	CONSTRAINT "receipt_lines_amounts_non_negative" CHECK (coalesce("receipt_lines"."price_minor", 0) >= 0 and coalesce("receipt_lines"."sum_minor", 0) >= 0 and coalesce("receipt_lines"."discount_minor", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_parts" (
	"receipt_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"photo" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receipt_parts_receipt_id_position_pk" PRIMARY KEY("receipt_id","position"),
	CONSTRAINT "receipt_parts_position_range" CHECK ("receipt_parts"."position" between 1 and 4),
	CONSTRAINT "receipt_parts_photo_size" CHECK (octet_length("receipt_parts"."photo") between 1 and 8388608),
	CONSTRAINT "receipt_parts_sides_positive" CHECK ("receipt_parts"."width" > 0 and "receipt_parts"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure" text,
	"parts" smallint NOT NULL,
	"country" char(2) NOT NULL,
	"language" text NOT NULL,
	"currency" char(3) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"queued_at" timestamp with time zone,
	"reading_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"reader_version" text,
	"layout" text,
	"tin" text,
	"printed_on" date,
	"printed_time" text,
	"receipt_no" text,
	"total_minor" bigint,
	"balanced" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "receipts_status_known" CHECK ("receipts"."status" in ('uploading', 'queued', 'reading', 'parsed', 'failed', 'recorded')),
	CONSTRAINT "receipts_failure_known" CHECK ("receipts"."failure" is null or "receipts"."failure" in ('reshoot', 'unreadable')),
	CONSTRAINT "receipts_failure_of_failed" CHECK (("receipts"."status" = 'failed') = ("receipts"."failure" is not null)),
	CONSTRAINT "receipts_parts_range" CHECK ("receipts"."parts" between 1 and 4),
	CONSTRAINT "receipts_country_known" CHECK ("receipts"."country" in ('AM')),
	CONSTRAINT "receipts_language_known" CHECK ("receipts"."language" in ('ru', 'en')),
	CONSTRAINT "receipts_currency_known" CHECK ("receipts"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "receipts_whole_when_queued" CHECK ("receipts"."status" = 'uploading' or "receipts"."queued_at" is not null),
	CONSTRAINT "receipts_attempts_non_negative" CHECK ("receipts"."attempts" >= 0),
	CONSTRAINT "receipts_layout_known" CHECK ("receipts"."layout" is null or "receipts"."layout" in ('card', 'table')),
	CONSTRAINT "receipts_total_non_negative" CHECK ("receipts"."total_minor" is null or "receipts"."total_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "receipt_line_images" ADD CONSTRAINT "receipt_line_images_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_parts" ADD CONSTRAINT "receipt_parts_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_line_images_confirmed_idx" ON "receipt_line_images" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "receipts_actor_created_idx" ON "receipts" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_queue_idx" ON "receipts" USING btree ("queued_at") WHERE "receipts"."status" = 'queued' and "receipts"."deleted_at" is null;