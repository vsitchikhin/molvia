-- A recorded receipt goes with its trip removed for good, a line with its purchase, and a cut-out row
-- with its line (MOL-240): before, both keys were `SET NULL`, and what a person removed lay on the
-- server, unseen, until erasure. What that left behind goes first, so the keys and the check hold: a
-- recorded receipt without its trip; a line of a recorded receipt without its purchase — a purchase
-- removed, or a line not recorded at «Записать», which goes at recording from now on (В-2), and the
-- two cannot be told apart; a cut-out row without its line.
DELETE FROM "receipts" WHERE "status" = 'recorded' AND "trip_id" IS NULL;--> statement-breakpoint
DELETE FROM "receipt_lines" "line" USING "receipts" "receipt"
WHERE "receipt"."id" = "line"."receipt_id" AND "receipt"."status" = 'recorded' AND "line"."expense_id" IS NULL;--> statement-breakpoint
DELETE FROM "receipt_line_images" "image" WHERE NOT EXISTS (
  SELECT 1 FROM "receipt_lines" "line"
  WHERE "line"."receipt_id" = "image"."receipt_id" AND "line"."position" = "image"."position"
);--> statement-breakpoint
ALTER TABLE "receipt_lines" DROP CONSTRAINT "receipt_lines_expense_id_expenses_id_fk";
--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "as_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_line_images" ADD CONSTRAINT "receipt_line_images_line" FOREIGN KEY ("receipt_id","position") REFERENCES "public"."receipt_lines"("receipt_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_recorded_with_trip" CHECK ("receipts"."status" <> 'recorded' or "receipts"."trip_id" is not null);--> statement-breakpoint
-- Whether «Записать» recorded a line as read (adversarial round 4, Р4-1): the shops' memory takes its
-- shelf price from it when a word is settled, never from the purchase as it is now. The lines recorded
-- before it are judged the one way left: a row cut out of the line confirmed (recording confirms only the
-- lines recorded as read, В-4), else the purchase still as the line was read — a sum put right since
-- reads as not read, the price named.
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
