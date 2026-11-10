-- MOL-362. Квота «Предложить товар» на человека (В-10 «а» аудита MOL-287): сколько новых товаров человек завёл в
-- общий справочник за свой день и какой это день. Счётчик, а не строки `items`: товар из «Записать» чека в них тот же,
-- а считаются только предложения. Как счёт чеков (0080), счёт — не правка строки: триггер `updated_at` его не замечает.
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at', 'receipts_day', 'receipts_sent', 'items_day', 'items_proposed']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "items_day" date;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "items_proposed" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_items_proposed_not_negative" CHECK ("actors"."items_proposed" >= 0);
