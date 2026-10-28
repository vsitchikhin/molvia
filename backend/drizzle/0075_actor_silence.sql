-- MOL-239. Стирание аккаунта после двух лет тишины: отметка последнего предупреждения бота (за 30 или за 7
-- дней) и когда оно отдано; `erasures.silent` — сколько из стёртых ушли за тишину (В-1 «а»); индекс по
-- `last_seen_at` — бот спрашивает каждую минуту. Отметка — не правка строки, как и визит (0073): триггер
-- `updated_at` её не замечает, иначе телефон счёл бы настройки молчащего «новее».
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['last_seen_at', 'silence_warning', 'silence_warned_at']))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "silence_warning" smallint;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "silence_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erasures" ADD COLUMN "silent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "actors_last_seen_at" ON "actors" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_silence_warning_whole" CHECK (("actors"."silence_warning" is null) = ("actors"."silence_warned_at" is null));--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_silence_warning_known" CHECK ("actors"."silence_warning" in (30, 7));--> statement-breakpoint
ALTER TABLE "erasures" ADD CONSTRAINT "erasures_silent_within" CHECK ("erasures"."silent" between 0 and "erasures"."erased");--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend', 'receipt_partial', 'receipt_partial_muted', 'silence'));