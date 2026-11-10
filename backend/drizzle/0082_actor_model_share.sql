-- MOL-367. Доля человека в тратах модели (Ф-10 аудита MOL-287, решения В-1…В-3 «а»): месяц UTC — тот же, что у
-- `model_spend`, — и сколько стоило чтение его чеков и брендов; `model_share_told` — месяц, о котором владелец уже
-- слышал. Счётчик, а не строки `receipts`: удалённый чек вернул бы свою цену. Счёт — не правка строки, как 0080 и 0081:
-- триггер `updated_at` его не замечает. Уведомление владельцу о выбранной доле — свой вид `model_share` (В-3 «а»).
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "model_month" date;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "model_spent_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "model_share_told" date;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_model_spent_not_negative" CHECK ("actors"."model_spent_micro_usd" >= 0);--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend', 'model_share', 'receipt_partial', 'receipt_partial_muted', 'silence'));