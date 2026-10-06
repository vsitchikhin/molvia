ALTER TABLE "receipts" DROP CONSTRAINT "receipts_failure_known";--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_parts_range";--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_country_known";--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_city_known";--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "source" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "shop_unit" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "shop" text;--> statement-breakpoint
CREATE INDEX "receipts_link_queue_idx" ON "receipts" USING btree ("next_attempt_at") WHERE "receipts"."source" = 'tax' and "receipts"."status" = 'queued' and "receipts"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_source_known" CHECK ("receipts"."source" in ('photo', 'tax'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_link_while_asked" CHECK ("receipts"."link" is null or ("receipts"."source" = 'tax' and "receipts"."status" in ('queued', 'reading')));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_link_asked_when" CHECK ("receipts"."source" = 'photo' or "receipts"."status" <> 'queued' or ("receipts"."link" is not null and "receipts"."next_attempt_at" is not null));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_failure_known" CHECK ("receipts"."failure" is null or "receipts"."failure" in ('reshoot', 'unreadable', 'missing', 'invalid'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_parts_range" CHECK (("receipts"."source" = 'photo' and "receipts"."parts" between 1 and 4)
          or ("receipts"."source" = 'tax' and "receipts"."parts" = 0));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_country_known" CHECK ("receipts"."country" in ('AM', 'RS'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_city_known" CHECK ("receipts"."city" is null or "receipts"."city" in ('Гюмри', 'Ереван', 'Белград', 'Нови-Сад'));