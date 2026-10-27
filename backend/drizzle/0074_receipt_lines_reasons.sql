CREATE TABLE "receipt_miss_parts" (
	"receipt" uuid NOT NULL,
	"position" smallint NOT NULL,
	"photo" "bytea" NOT NULL,
	CONSTRAINT "receipt_miss_parts_receipt_position_pk" PRIMARY KEY("receipt","position"),
	CONSTRAINT "receipt_miss_parts_position_range" CHECK ("receipt_miss_parts"."position" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "receipt_misses" (
	"receipt" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid,
	"actor_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"keep_until" timestamp with time zone NOT NULL,
	"retaken_at" timestamp with time zone,
	"reader_version" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"reading" jsonb NOT NULL,
	CONSTRAINT "receipt_misses_kept_after_read" CHECK ("receipt_misses"."keep_until" > "receipt_misses"."read_at"),
	CONSTRAINT "receipt_misses_receipt_own" CHECK ("receipt_misses"."receipt_id" is null or "receipt_misses"."receipt_id" = "receipt_misses"."receipt")
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
ALTER TABLE "model_receipt_days" DROP CONSTRAINT "model_receipt_days_counts_non_negative";--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "receipt_days" DROP CONSTRAINT "receipt_days_counts_non_negative";--> statement-breakpoint
ALTER TABLE "tax_receipt_days" DROP CONSTRAINT "tax_receipt_days_counts_non_negative";--> statement-breakpoint
ALTER TABLE "model_receipt_days" ADD COLUMN "added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_days" ADD COLUMN "added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_receipt_days" ADD COLUMN "added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_miss_parts" ADD CONSTRAINT "receipt_miss_parts_receipt_receipt_misses_receipt_fk" FOREIGN KEY ("receipt") REFERENCES "public"."receipt_misses"("receipt") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_misses" ADD CONSTRAINT "receipt_misses_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_misses" ADD CONSTRAINT "receipt_misses_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_misses_keep_until_idx" ON "receipt_misses" USING btree ("keep_until");--> statement-breakpoint
CREATE INDEX "receipt_misses_receipt_id_idx" ON "receipt_misses" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_misses_actor_idx" ON "receipt_misses" USING btree ("actor_id");--> statement-breakpoint
ALTER TABLE "model_receipt_days" ADD CONSTRAINT "model_receipt_days_counts_non_negative" CHECK (least("model_receipt_days"."read", "model_receipt_days"."read_partly", "model_receipt_days"."reshoot", "model_receipt_days"."no_items", "model_receipt_days"."unreadable", "model_receipt_days"."recorded", "model_receipt_days"."lines", "model_receipt_days"."lines_edited", "model_receipt_days"."lines_skipped", "model_receipt_days"."lines_item", "model_receipt_days"."lines_figures", "model_receipt_days"."totals_corrected", "model_receipt_days"."added", "model_receipt_days"."within_5m", "model_receipt_days"."within_15m", "model_receipt_days"."within_1h", "model_receipt_days"."within_1d", "model_receipt_days"."later") >= 0);--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend', 'receipt_partial', 'receipt_partial_muted'));--> statement-breakpoint
ALTER TABLE "receipt_days" ADD CONSTRAINT "receipt_days_counts_non_negative" CHECK (least("receipt_days"."read", "receipt_days"."read_partly", "receipt_days"."reshoot", "receipt_days"."no_items", "receipt_days"."unreadable", "receipt_days"."recorded", "receipt_days"."lines", "receipt_days"."lines_edited", "receipt_days"."lines_skipped", "receipt_days"."lines_item", "receipt_days"."lines_figures", "receipt_days"."totals_corrected", "receipt_days"."added", "receipt_days"."within_5m", "receipt_days"."within_15m", "receipt_days"."within_1h", "receipt_days"."within_1d", "receipt_days"."later") >= 0);--> statement-breakpoint
ALTER TABLE "tax_receipt_days" ADD CONSTRAINT "tax_receipt_days_counts_non_negative" CHECK (least("tax_receipt_days"."sent_qr", "tax_receipt_days"."sent_qr_missed", "tax_receipt_days"."sent_paste", "tax_receipt_days"."sent_paste_missed", "tax_receipt_days"."sent_unnamed", "tax_receipt_days"."read", "tax_receipt_days"."missing", "tax_receipt_days"."invalid", "tax_receipt_days"."empty", "tax_receipt_days"."unreadable", "tax_receipt_days"."specs_ok", "tax_receipt_days"."specs_failed", "tax_receipt_days"."specs_skipped", "tax_receipt_days"."lines_coded", "tax_receipt_days"."recorded", "tax_receipt_days"."lines", "tax_receipt_days"."lines_edited", "tax_receipt_days"."lines_skipped", "tax_receipt_days"."lines_item", "tax_receipt_days"."lines_figures", "tax_receipt_days"."totals_corrected", "tax_receipt_days"."added", "tax_receipt_days"."codes_written", "tax_receipt_days"."within_5m", "tax_receipt_days"."within_15m", "tax_receipt_days"."within_1h", "tax_receipt_days"."within_1d", "tax_receipt_days"."later") >= 0);