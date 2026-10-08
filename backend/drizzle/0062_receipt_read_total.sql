-- The total as the reader read it in one place (MOL-244): a total no second source vouches for is shown
-- no more, and «Прочитали не всё» measures the lines against this one. A receipt read before keeps none:
-- its total is the one it was shown with, and the hint reads that.
ALTER TABLE "receipts" ADD COLUMN "read_total_minor" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_read_total_non_negative" CHECK ("receipts"."read_total_minor" is null or "receipts"."read_total_minor" >= 0);