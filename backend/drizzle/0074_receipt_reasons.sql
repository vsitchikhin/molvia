CREATE TABLE "receipt_miss_parts" (
	"receipt_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"photo" "bytea" NOT NULL,
	CONSTRAINT "receipt_miss_parts_receipt_id_position_pk" PRIMARY KEY("receipt_id","position"),
	CONSTRAINT "receipt_miss_parts_position_range" CHECK ("receipt_miss_parts"."position" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "receipt_misses" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"keep_until" timestamp with time zone NOT NULL,
	"reader_version" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"reading" jsonb NOT NULL,
	CONSTRAINT "receipt_misses_kept_after_read" CHECK ("receipt_misses"."keep_until" > "receipt_misses"."read_at")
);
--> statement-breakpoint
CREATE TABLE "receipt_reason_days" (
	"day" date NOT NULL,
	"reader" text NOT NULL,
	"country" char(2) NOT NULL,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_reason_days_day_reader_country_scope_reason_pk" PRIMARY KEY("day","reader","country","scope","reason"),
	CONSTRAINT "receipt_reason_days_reader_known" CHECK ("receipt_reason_days"."reader" in ('model', 'ocr')),
	CONSTRAINT "receipt_reason_days_scope_known" CHECK ("receipt_reason_days"."scope" in ('read', 'receipt', 'line')),
	CONSTRAINT "receipt_reason_days_n_non_negative" CHECK ("receipt_reason_days"."n" >= 0)
);
--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "receipt_miss_parts" ADD CONSTRAINT "receipt_miss_parts_receipt_id_receipt_misses_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt_misses"("receipt_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_misses" ADD CONSTRAINT "receipt_misses_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_misses_keep_until_idx" ON "receipt_misses" USING btree ("keep_until");--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend', 'receipt_partial', 'receipt_partial_muted'));