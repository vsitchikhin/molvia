-- Правки рук здесь три, и все три генератор сделать не мог.
--
-- 1. УБОРКА ПЕРЕД ОГРАНИЧЕНИЯМИ. Каждое ограничение ниже объявляет незаконным то, что было
--    законно под 0006, а миграция идёт на старте API: непочиненная строка означает не
--    поднявшийся сервис. Прецедент и разрешение владельца — те же, что у 0002: чиним данные,
--    а не отменяем правило. Где починка возможна без потери — чиним (курс обнуляется,
--    место снимается, дубли мест сливаются); где восстановить нечего — удаляем и говорим
--    об этом вслух (события без разреза, подсказки шире ключа).
-- 2. КОЛОНКА `item_kind` заполняется из справочника: `ADD COLUMN ... NOT NULL` не встанет
--    на таблице со строками, а вид позиции известен — он лежит в `items`.
-- 3. ТРИГГЕР на `updated_at`. drizzle-kit про триггеры не знает; `$onUpdate` их не заменяет —
--    он живёт в построителе запросов, то есть сырой SQL, каскад и второй клиент проходят
--    мимо него. Колонка существует ради того, чтобы переоценка оставляла след, поэтому
--    механизм должен быть один и в базе.

ALTER TABLE "places" DROP CONSTRAINT "places_kind_country_city_name_key";--> statement-breakpoint
ALTER TABLE "verdicts" DROP CONSTRAINT "verdicts_item_id_items_id_fk";--> statement-breakpoint

-- Курс, который не может быть курсом: снимок снимается целиком, поход остаётся.
UPDATE "trips"
SET "rate_base" = NULL, "rate_quote" = NULL, "rate_scaled" = NULL,
    "rate_source" = NULL, "rate_as_of" = NULL
WHERE "rate_scaled" IS NOT NULL AND "rate_scaled" <= 0;--> statement-breakpoint

-- Ключ поиска, который ничего не содержит: позиция иначе недостижима поиском навсегда.
-- Настоящая починка — пересчитать ключ из названия, но транслитерация живёт в TS; здесь
-- строка получает метку, по которой её найдёт MOL-7 при первой же правке позиции.
UPDATE "items"
SET "search_key" = 'nokey-' || "id"
WHERE btrim("search_key", E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF') = '';--> statement-breakpoint

-- События, которые ворота не сосчитают. Восстановить разрез неоткуда — журнал append-only,
-- дозаполнить нечем, — поэтому строка удаляется, а не остаётся ложным нулём в счётчике.
DELETE FROM "events"
WHERE "type" NOT IN ('session_started', 'catalogue_viewed')
   OR jsonb_typeof("payload") <> 'object'
   OR ("type" = 'catalogue_viewed'
       AND NOT (jsonb_exists("payload", 'subject')
                AND "payload" ->> 'subject' IN ('product', 'venue')
                AND "payload" - 'subject' = '{}'::jsonb))
   OR ("type" = 'session_started' AND "payload" <> '{}'::jsonb);--> statement-breakpoint

-- Подсказка шире, чем строка btree: она и раньше не работала — вставка отвечала 54000.
DELETE FROM "search_picks" WHERE octet_length("query_key") > 600;--> statement-breakpoint
ALTER TABLE "search_picks" ALTER COLUMN "query_key" SET DATA TYPE varchar(600);--> statement-breakpoint

-- Дубли мест сливаются в старейшую карточку: сначала на неё переводятся походы и вердикты,
-- потом лишние строки уходят. Это слияние, а не удаление данных: история цен сходится
-- обратно в одно место, ради чего уникальность и переписывается.
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", lower(normalize("city", NFKC)), lower(normalize("name", NFKC))
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "trips" t SET "place_id" = r.keeper
FROM ranked r WHERE t."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", lower(normalize("city", NFKC)), lower(normalize("name", NFKC))
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "verdicts" v SET "place_id" = r.keeper
FROM ranked r WHERE v."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", lower(normalize("city", NFKC)), lower(normalize("name", NFKC))
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
DELETE FROM "places" p USING ranked r WHERE p."id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint

ALTER TABLE "verdicts" ADD COLUMN "item_kind" text;--> statement-breakpoint
UPDATE "verdicts" v SET "item_kind" = i."kind" FROM "items" i WHERE i."id" = v."item_id";--> statement-breakpoint
ALTER TABLE "verdicts" ALTER COLUMN "item_kind" SET NOT NULL;--> statement-breakpoint

-- Вердикт на товар, поставленный «в месте», — это и есть второй голос одного человека.
-- Если у той же пары «владелец + позиция» уже есть голос без места, лишний уходит: канон
-- продукта — вердикт на позицию, место у товара не значит ничего. Остальным место снимается.
DELETE FROM "verdicts" extra
USING "verdicts" kept
WHERE extra."item_kind" = 'product' AND extra."place_id" IS NOT NULL
  AND kept."actor_id" = extra."actor_id" AND kept."item_id" = extra."item_id"
  AND kept."place_id" IS NULL;--> statement-breakpoint
UPDATE "verdicts" SET "place_id" = NULL
WHERE "item_kind" = 'product' AND "place_id" IS NOT NULL;--> statement-breakpoint

-- Уникальность по паре ставится раньше ключа, который на неё ссылается: генератор
-- выдал их в обратном порядке, и Postgres на это отвечает отказом.
ALTER TABLE "items" ADD CONSTRAINT "items_id_kind_key" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_item_id_kind_fk" FOREIGN KEY ("item_id","item_kind") REFERENCES "public"."items"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "places_identity_key" ON "places" USING btree ("kind","country",lower(normalize("city", NFKC)),lower(normalize("name", NFKC)));--> statement-breakpoint
CREATE INDEX "trips_place_idx" ON "trips" USING btree ("place_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_type_known" CHECK ("events"."type" in ('session_started', 'catalogue_viewed'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payload_is_object" CHECK (jsonb_typeof("events"."payload") = 'object');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payload_matches_type" CHECK (("events"."type" <> 'catalogue_viewed'
             or (jsonb_exists("events"."payload", 'subject')
                 and "events"."payload" ->> 'subject' in ('product', 'venue')
                 and "events"."payload" - 'subject' = '{}'::jsonb))
          and ("events"."type" <> 'session_started'
             or "events"."payload" = '{}'::jsonb));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_search_key_present" CHECK (btrim("items"."search_key", E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF') <> '');--> statement-breakpoint
ALTER TABLE "search_picks" ADD CONSTRAINT "search_picks_query_key_indexable" CHECK (octet_length("search_picks"."query_key") <= 600);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_positive" CHECK ("trips"."rate_scaled" is null or "trips"."rate_scaled" > 0);--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_place_matches_kind" CHECK (("verdicts"."item_kind" = 'product') = ("verdicts"."place_id" is null));--> statement-breakpoint

-- Одна функция на обе таблицы: смысл один — «строка изменилась, и это видно».
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "verdicts_touch_updated_at" BEFORE UPDATE ON "verdicts"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
