CREATE TABLE "tax_receipt_days" (
	"day" date PRIMARY KEY NOT NULL,
	"sent_qr" integer DEFAULT 0 NOT NULL,
	"sent_qr_missed" integer DEFAULT 0 NOT NULL,
	"sent_paste" integer DEFAULT 0 NOT NULL,
	"sent_paste_missed" integer DEFAULT 0 NOT NULL,
	"sent_unnamed" integer DEFAULT 0 NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"missing" integer DEFAULT 0 NOT NULL,
	"invalid" integer DEFAULT 0 NOT NULL,
	"empty" integer DEFAULT 0 NOT NULL,
	"unreadable" integer DEFAULT 0 NOT NULL,
	"specs_ok" integer DEFAULT 0 NOT NULL,
	"specs_failed" integer DEFAULT 0 NOT NULL,
	"specs_skipped" integer DEFAULT 0 NOT NULL,
	"lines_coded" integer DEFAULT 0 NOT NULL,
	"recorded" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	"lines_edited" integer DEFAULT 0 NOT NULL,
	"lines_skipped" integer DEFAULT 0 NOT NULL,
	"lines_item" integer DEFAULT 0 NOT NULL,
	"lines_figures" integer DEFAULT 0 NOT NULL,
	"totals_corrected" integer DEFAULT 0 NOT NULL,
	"codes_written" integer DEFAULT 0 NOT NULL,
	"within_5m" integer DEFAULT 0 NOT NULL,
	"within_15m" integer DEFAULT 0 NOT NULL,
	"within_1h" integer DEFAULT 0 NOT NULL,
	"within_1d" integer DEFAULT 0 NOT NULL,
	"later" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tax_receipt_days_counts_non_negative" CHECK (least("tax_receipt_days"."sent_qr", "tax_receipt_days"."sent_qr_missed", "tax_receipt_days"."sent_paste", "tax_receipt_days"."sent_paste_missed", "tax_receipt_days"."sent_unnamed", "tax_receipt_days"."read", "tax_receipt_days"."missing", "tax_receipt_days"."invalid", "tax_receipt_days"."empty", "tax_receipt_days"."unreadable", "tax_receipt_days"."specs_ok", "tax_receipt_days"."specs_failed", "tax_receipt_days"."specs_skipped", "tax_receipt_days"."lines_coded", "tax_receipt_days"."recorded", "tax_receipt_days"."lines", "tax_receipt_days"."lines_edited", "tax_receipt_days"."lines_skipped", "tax_receipt_days"."lines_item", "tax_receipt_days"."lines_figures", "tax_receipt_days"."totals_corrected", "tax_receipt_days"."codes_written", "tax_receipt_days"."within_5m", "tax_receipt_days"."within_15m", "tax_receipt_days"."within_1h", "tax_receipt_days"."within_1d", "tax_receipt_days"."later") >= 0),
	CONSTRAINT "tax_receipt_days_edited_within_lines" CHECK ("tax_receipt_days"."lines_edited" <= "tax_receipt_days"."lines")
);
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "qr_missed" boolean;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_gtin_shape" CHECK ("receipt_lines"."gtin" is null or "receipt_lines"."gtin" ~ '^([0-9]{8}|[0-9]{12,14})$');--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_via_known" CHECK ("receipts"."via" is null or "receipts"."via" in ('qr', 'paste'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_via_of_link" CHECK (("receipts"."source" = 'tax' or ("receipts"."via" is null and "receipts"."qr_missed" is null))
          and ("receipts"."qr_missed" is null or "receipts"."via" is not null));