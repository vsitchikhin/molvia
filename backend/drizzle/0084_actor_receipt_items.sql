-- MOL-373. Потолок новых товаров у «Записать» чека (А1 адверсариала MOL-362, решение В-3 «в»; В-1 «а» MOL-373):
-- сколько новых товаров «Записать» чеков человека завела в общий справочник за его день и какой это день. Свой счёт,
-- не `items_proposed`: квоты «Предложить товар» и «Записать» друг у друга не берут. Счёт — не правка строки, как
-- 0080–0082: триггер `updated_at` его не замечает.
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "receipt_items_day" date;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "receipt_items_new" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_receipt_items_new_not_negative" CHECK ("actors"."receipt_items_new" >= 0);