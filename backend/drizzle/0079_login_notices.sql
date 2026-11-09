-- MOL-361 (аудит MOL-287 Ф-3, решение владельца В-9 «а»): вход, о котором бот ещё не сказал владельцу
-- аккаунта, — строка ставится сбором сессии, выдача боту отмечает её (`handed_at`), слово бота отпускает
-- ушедшее и возвращает отказанное с `not_before`, за спины остальных; без слова за аренду — отпускается
-- неотправленной (адверсариальное А1, А2). Без ключа на сессию (В-1 «а»): сессия, завершённая до выдачи, всё
-- равно попадает в сообщение. Живые сессии на момент выкатки уведомлений не получают. И счёт сессий,
-- завершённых кнопкой под сообщением (В-4 «а»).
CREATE TABLE "login_notices" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"device_name" varchar(80),
	"signed_in_at" timestamp with time zone NOT NULL,
	"handed_at" timestamp with time zone,
	"not_before" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_days" DROP CONSTRAINT "login_days_counts_non_negative";--> statement-breakpoint
ALTER TABLE "login_days" ADD COLUMN "ended_by_notice" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "login_notices" ADD CONSTRAINT "login_notices_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_days" ADD CONSTRAINT "login_days_counts_non_negative" CHECK (least("login_days"."started", "login_days"."again", "login_days"."confirmed", "login_days"."declined", "login_days"."collected", "login_days"."expired_unconfirmed", "login_days"."expired_confirmed", "login_days"."refused", "login_days"."ended_by_notice") >= 0);