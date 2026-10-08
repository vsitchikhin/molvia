-- Whether «Записать» recorded a line as read (MOL-240, adversarial round 4, Р4-1): the shops' memory
-- takes its shelf price from it when a word is settled, never from the purchase as it is now. The lines
-- recorded before it are judged the one way left: a row cut out of the line confirmed (recording confirms
-- only the lines recorded as read, В-4), else the purchase still as the line was read — a sum put right
-- since reads as not read, the price named.
ALTER TABLE "receipt_lines" ADD COLUMN "as_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "receipt_lines" "line" SET "as_read" = true
FROM "receipts" "receipt", "expenses" "bought"
WHERE "receipt"."id" = "line"."receipt_id" AND "receipt"."status" = 'recorded'
  AND "bought"."id" = "line"."expense_id"
  AND (
    EXISTS (
      SELECT 1 FROM "receipt_line_images" "row"
      WHERE "row"."receipt_id" = "line"."receipt_id" AND "row"."position" = "line"."position"
        AND "row"."confirmed_at" IS NOT NULL
    )
    OR (
      "line"."settled"
      AND "bought"."qty_milli" IS NOT DISTINCT FROM "line"."qty_milli"
      AND "bought"."qty_unit" IS NOT DISTINCT FROM "line"."qty_unit"
      AND "bought"."amount_minor" = "line"."sum_minor"
      AND "bought"."amount_currency" = "receipt"."currency"
    )
  );
