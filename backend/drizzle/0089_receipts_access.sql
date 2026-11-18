-- MOL-275. Доступ к модели, что читает чеки (MOL-271): пробник — 10 чеков на человека, всем, и тем, кто был до него;
-- потолок — 100 чеков в месяц телефона, по месяцу, в котором чек отправлен (`receipts.sent_month`, MOL-121); засчитан
-- ли чек и чем (`receipts.counted`: пробником или только местом в сотне) — чтобы повтор того же чека не считался, а
-- «Переснять» возвращало взятое (`receipts.retaken_at`, В-4 «а»). Счётчики, а не строки `receipts`: удалённый чек
-- вернул бы своё место. Счёт — не правка строки, как 0080–0087: триггер `updated_at` его не замечает. Чекам, что были
-- до неё, — месяц их прихода по Еревану; образ до неё, откаченный, не пишет месяца — пишет умолчание, тот же месяц.
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new', 'locale', 'trial_receipts_left', 'model_receipts_month', 'model_receipts_read'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed', 'model_month', 'model_spent_micro_usd', 'model_share_told', 'receipt_items_day', 'receipt_items_new', 'locale', 'trial_receipts_left', 'model_receipts_month', 'model_receipts_read']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "trial_receipts_left" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "model_receipts_month" date;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "model_receipts_read" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "sent_month" date;--> statement-breakpoint
UPDATE "receipts" SET "sent_month" = (date_trunc('month', "created_at" at time zone 'Asia/Yerevan'))::date;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "sent_month" SET DEFAULT (date_trunc('month', now() at time zone 'Asia/Yerevan'))::date;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "sent_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "counted" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "retaken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_trial_receipts_left_known" CHECK ("actors"."trial_receipts_left" between 0 and 10);--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_model_receipts_read_not_negative" CHECK ("actors"."model_receipts_read" >= 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_counted_known" CHECK ("receipts"."counted" in ('trial', 'month'));
