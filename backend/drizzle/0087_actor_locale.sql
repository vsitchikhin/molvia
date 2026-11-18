-- MOL-398. Язык, на котором приложение человека говорило последним (решение В-1 «в»): его называет каждый запрос
-- телефона, страж пишет его, только когда он другой; на нём бот шлёт напоминание об оценке, пусто — по-русски, как
-- было. Не правка строки, как и визит (0084): триггер `updated_at` его не замечает.
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new', 'locale'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new', 'locale']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_locale_known" CHECK ("actors"."locale" in ('ru', 'en'));