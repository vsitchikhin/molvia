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

-- Оценка, датированная будущим: под 0006 законна, а дальше ломает смысл `updated_at` —
-- любая правка ставила бы след раньше оценки. Дата подтягивается к настоящему, обе колонки
-- сразу, чтобы «переоценка не раньше оценки» осталось верным.
UPDATE "verdicts"
SET "rated_at" = clock_timestamp(),
    "updated_at" = greatest("updated_at", clock_timestamp())
WHERE "rated_at" > clock_timestamp();--> statement-breakpoint
UPDATE "verdicts" SET "updated_at" = clock_timestamp()
WHERE "updated_at" > clock_timestamp();--> statement-breakpoint

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

-- Вердикты приводятся в порядок до слияния мест, а не после: слияние переводит оба голоса
-- на одну карточку и само порождает дубль тройки «владелец + позиция + место».
--
-- Товар, оценённый «в месте», — это второй голос одного человека, и снять место у обоих
-- мало: две строки стали бы одной и той же тройкой, а уникальность ответила бы 23505.
-- Поэтому пара «владелец + позиция» сводится к одному голосу — **последнему** по дате
-- оценки: в продукте переоценка заменяет прежнее мнение, а не спорит с ним. (У мест
-- наоборот выживает старейшая карточка: там ценна накопленная история, а не свежесть.)
-- Вид позиции берётся из справочника: колонки `item_kind` на этом шаге ещё нет.
WITH ranked AS (
  SELECT v."id", row_number() OVER (
    PARTITION BY v."actor_id", v."item_id" ORDER BY v."rated_at" DESC, v."id" DESC
  ) AS n
  FROM "verdicts" v JOIN "items" i ON i."id" = v."item_id"
  WHERE i."kind" = 'product'
)
DELETE FROM "verdicts" v USING ranked r WHERE v."id" = r."id" AND r.n > 1;--> statement-breakpoint

-- Блюдо, оценённое «нигде»: место — половина смысла такой оценки («та карбонара только
-- там»), и взять его неоткуда. Строка удаляется по той же причине и с тем же сожалением,
-- что событие без разреза: восстановить нечем.
DELETE FROM "verdicts" v USING "items" i
WHERE i."id" = v."item_id" AND i."kind" = 'dish' AND v."place_id" IS NULL;--> statement-breakpoint

-- Слияние мест сталкивает и вердикты: блюдо, оценённое в двух карточках одного заведения,
-- после перевода на старейшую станет одной и той же тройкой «владелец + позиция + место»,
-- и уникальность ответит 23505 прямо на UPDATE. Поэтому вердикты сводятся по их будущему
-- месту заранее — снова по последнему мнению.
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(normalize("city", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(normalize("name", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
), collapsed AS (
  SELECT v."id", row_number() OVER (
    PARTITION BY v."actor_id", v."item_id", coalesce(r.keeper, v."place_id")
    ORDER BY v."rated_at" DESC, v."id" DESC
  ) AS n
  FROM "verdicts" v LEFT JOIN ranked r ON r."id" = v."place_id"
)
DELETE FROM "verdicts" v USING collapsed c WHERE v."id" = c."id" AND c.n > 1;--> statement-breakpoint

-- Дубли мест сливаются в старейшую карточку: сначала на неё переводятся походы и вердикты,
-- потом лишние строки уходят. Это слияние, а не удаление данных: история цен сходится
-- обратно в одно место, ради чего уникальность и переписывается.
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(normalize("city", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(normalize("name", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "trips" t SET "place_id" = r.keeper
FROM ranked r WHERE t."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(normalize("city", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(normalize("name", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "verdicts" v SET "place_id" = r.keeper
FROM ranked r WHERE v."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(normalize("city", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(normalize("name", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
DELETE FROM "places" p USING ranked r WHERE p."id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint

ALTER TABLE "verdicts" ADD COLUMN "item_kind" text;--> statement-breakpoint
UPDATE "verdicts" v SET "item_kind" = i."kind" FROM "items" i WHERE i."id" = v."item_id";--> statement-breakpoint
ALTER TABLE "verdicts" ALTER COLUMN "item_kind" SET NOT NULL;--> statement-breakpoint

UPDATE "verdicts" SET "place_id" = NULL WHERE "place_id" IS NOT NULL AND "item_kind" = 'product';--> statement-breakpoint

-- Уникальность по паре ставится раньше ключа, который на неё ссылается: генератор
-- выдал их в обратном порядке, и Postgres на это отвечает отказом.
ALTER TABLE "items" ADD CONSTRAINT "items_id_kind_key" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_item_id_kind_fk" FOREIGN KEY ("item_id","item_kind") REFERENCES "public"."items"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "places_identity_key" ON "places" USING btree ("kind","country",btrim(lower(normalize("city", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'),btrim(lower(normalize("name", NFKC)), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'));--> statement-breakpoint
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
-- clock_timestamp(), а не now(): now() — это метка начала транзакции, и любой rated_at,
-- снятый приложением после BEGIN, оказался бы позже неё. Тогда правка вердикта в той же
-- транзакции, что и вставка, отбивалась бы constraint'ом updated_at >= rated_at — всегда,
-- а не иногда. clock_timestamp() берётся в момент срабатывания и заведомо не раньше.
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Дата оценки приходит снаружи, и в будущем она не бывает. CHECK этого сказать не может —
-- ему нельзя звать now(), — а триггеру можно, и это единственное место, где такое правило
-- вообще выразимо. Без него строка с датой на век вперёд либо запирается навсегда (любая
-- правка ставит след раньше оценки), либо, если след подтягивать к оценке, позволяет
-- клиенту прижать `updated_at` к тому же веку: «переоценено» и «не трогали» становятся
-- неразличимы. Сервер и база стоят на одной машине и метка снимается прямо перед вставкой,
-- поэтому запас на расхождение часов не нужен: дата из будущего — сломанная строка.
CREATE OR REPLACE FUNCTION "refuse_future_rating"() RETURNS trigger AS $$
BEGIN
  IF NEW."rated_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'verdict rated in the future: %', NEW."rated_at"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'verdicts_rated_at_not_future';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "verdicts_rated_at_not_future" BEFORE INSERT OR UPDATE ON "verdicts"
  FOR EACH ROW EXECUTE FUNCTION "refuse_future_rating"();--> statement-breakpoint
-- WHEN: колонка отмечает, что строка изменилась, а не что по ней прошли. Пустой UPDATE —
-- повтор запроса, правка отзыва на тот же текст, ремонтная миграция по всем вердиктам —
-- иначе переписал бы «когда переоценили» всем подряд.
CREATE TRIGGER "verdicts_touch_updated_at" BEFORE UPDATE ON "verdicts"
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "actors_touch_updated_at" BEFORE UPDATE ON "actors"
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION "set_updated_at"();
