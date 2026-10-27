-- MOL-238. Последний визит аккаунта: когда человек последний раз пользовался приложением или входил в него —
-- часы «двух лет тишины»
-- MOL-239. Сессия помнит своё последнее использование, но уходит через 180 дней или по «Выйти».
--
-- Триггер — первым: колонка отмечает визит, а не правку строки, и `updated_at` её не замечает. Иначе
-- первый запрос каждого дня делал бы владельца «новее» для телефона, который по `updatedAt` решает,
-- чьи настройки свежее, — и заполнение ниже сдвинуло бы `updated_at` всем.
DROP TRIGGER "actors_touch_updated_at" ON "actors";--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN ((to_jsonb(OLD) - 'last_seen_at') IS DISTINCT FROM (to_jsonb(NEW) - 'last_seen_at'))
  EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
-- Самое позднее, что сервер знает о человеке в приложении: использование сессии, но и записи — сессия
-- отмечает использование раз в сутки и бывает уже удалена; товар и штрихкод в каталоге — тоже его записи, и
-- поздние моменты самих записей: счёт или сумма чека у старого похода, правка, удаление, архив, «Записать».
-- Бот визитом не считается (В-1 «а»): ответ разработчику в Telegram — продолжение нити (`thread_id`), и
-- его нет. Цена: оценка кнопкой напоминания двигает `verdicts.updated_at`, а в строке оценки не видно,
-- откуда она, — без `verdicts` целиком потерялась бы оценка из «Оценок». Перекос — в «позже»: аккаунт
-- хранится дольше двух лет, а не стирается раньше. `greatest` пропускает пустые; `least(now())` — на
-- случай момента с телефона, ушедшего вперёд.
UPDATE "actors" AS "a" SET "last_seen_at" = least(now(), greatest(
  "a"."created_at", "a"."consented_at", "a"."analytics_off_at", "a"."analytics_on_at", "a"."income_currency_since",
  (SELECT max("last_seen_at") FROM "sessions" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("t"."started_at", "t"."finished_at", "t"."account_set_at", "t"."receipt_set_at", "t"."deleted_at")) FROM "trips" AS "t" WHERE "t"."actor_id" = "a"."id"),
  (SELECT max("e"."created_at") FROM "expenses" AS "e" JOIN "trips" AS "t" ON "t"."id" = "e"."trip_id" WHERE "t"."actor_id" = "a"."id"),
  (SELECT max(greatest("updated_at", "deleted_at")) FROM "verdicts" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "recorded_at", "deleted_at")) FROM "receipts" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "amended_at", "account_set_at", "deleted_at")) FROM "exchanges" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "amended_at", "account_set_at", "deleted_at")) FROM "incomes" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "amended_at", "account_set_at", "deleted_at")) FROM "spendings" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "amended_at", "deleted_at")) FROM "account_transfers" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "archived_at", "deleted_at")) FROM "money_accounts" WHERE "actor_id" = "a"."id"),
  (SELECT max("created_at") FROM "money_account_checks" WHERE "actor_id" = "a"."id"),
  (SELECT max(greatest("created_at", "archived_at")) FROM "spending_categories" WHERE "actor_id" = "a"."id"),
  (SELECT max("updated_at") FROM "budget_plans" WHERE "actor_id" = "a"."id"),
  (SELECT max("created_at") FROM "feedback" WHERE "actor_id" = "a"."id" AND "thread_id" IS NULL),
  (SELECT max("created_at") FROM "items" WHERE "created_by" = "a"."id"),
  (SELECT max("added_at") FROM "item_barcodes" WHERE "added_by" = "a"."id"),
  (SELECT max("last_picked_at") FROM "search_picks" WHERE "actor_id" = "a"."id"),
  (SELECT max("occurred_at") FROM "events" WHERE "actor_id" = "a"."id")
));--> statement-breakpoint
ALTER TABLE "actors" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "actors" ALTER COLUMN "last_seen_at" SET NOT NULL;
