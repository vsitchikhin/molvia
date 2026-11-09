-- MOL-360. Квота чеков на человека (В-8 «а» аудита MOL-287): сколько чеков человек отправил за свой день и какой это
-- день (В-1 «а»). Счётчик, а не строки `receipts`: удалённый чек уходит оттуда через 10 минут и вернул бы место в
-- сутках. Счёт — не правка строки, как визит (0073) и отметка тишины (0075): триггер `updated_at` его не замечает,
-- иначе телефон счёл бы настройки отправившего чек «новее».
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "receipts_day" date;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "receipts_sent" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_receipts_sent_not_negative" CHECK ("actors"."receipts_sent" >= 0);