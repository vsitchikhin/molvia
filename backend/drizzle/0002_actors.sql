CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"country" char(2) NOT NULL,
	"city" varchar(120) NOT NULL,
	"spend_currency" char(3) NOT NULL,
	"income_currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actors_country_iso" CHECK ("actors"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "actors_spend_currency_known" CHECK ("actors"."spend_currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "actors_income_currency_known" CHECK ("actors"."income_currency" in ('AMD', 'RUB', 'USD', 'EUR'))
);
--> statement-breakpoint
-- Правка руками. События писались случайным actor_id, пока таблицы владельцев не
-- существовало, и внешний ключ поверх таких строк не встанет.
--
-- Что именно делает эта строка, без обиняков: `actors` только что создана и пуста, поэтому
-- она удаляет **весь** журнал, сколько бы в нём ни было записей. Это принято сознательно —
-- продуктовой базы не существует, первый деплой это MOL-37, а накопленные события
-- принадлежат только базам разработки и тестов, где они и без того шум. После этой
-- миграции ключ не даст осиротевшей строке появиться снова.
DELETE FROM "events" WHERE "actor_id" NOT IN (SELECT "id" FROM "actors");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;