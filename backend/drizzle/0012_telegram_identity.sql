-- Правка руками. `telegram_user_id` объявлена NOT NULL, а взять её для уже существующих
-- владельцев неоткуда: ключ от аккаунта хранится у Telegram, а не у нас, и придумать его
-- за человека нельзя.
--
-- Что именно делают строки ниже, без обиняков: они удаляют **всех** владельцев и всё, что на
-- них висит, — походы с тратами, вердикты, запомненный выбор, журнал событий. Это принято
-- сознательно и согласовано с владельцем 20.09.2026 (MOL-52, В-1): продуктовой базы не
-- существует, первый деплой это MOL-37, а накопленное принадлежит только базам разработки и
-- тестов, где это след e2e и ручных проб.
--
-- Что переживает и почему — по разным причинам, и их стоит различать. Позиции справочника
-- остаются, потеряв автора: у `items.created_by` внешний ключ `ON DELETE SET NULL`. Штрихкоды
-- висят на позиции, а не на владельце. Места и кеш курсов на владельца не ссылаются вовсе,
-- так что удалять их нечему — а не «спасает каскад», как здесь было написано сначала.
--
-- Порядок не произволен. Каскада на владельца нет ни у походов, ни у вердиктов, ни у выбора,
-- а `events` держит на него настоящий внешний ключ (0002_actors) — значит детей удаляем сами
-- и только потом владельцев. Траты уходят каскадом вместе с походами.
DELETE FROM "search_picks";--> statement-breakpoint
DELETE FROM "verdicts";--> statement-breakpoint
DELETE FROM "trips";--> statement-breakpoint
DELETE FROM "events";--> statement-breakpoint
DELETE FROM "actors";--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "telegram_user_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_telegram_user_id_key" UNIQUE("telegram_user_id");--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_telegram_user_id_positive" CHECK ("actors"."telegram_user_id" > 0);--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_telegram_user_id_safe" CHECK ("actors"."telegram_user_id" < 9007199254740992);
