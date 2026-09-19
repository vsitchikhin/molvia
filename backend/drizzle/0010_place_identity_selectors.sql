DROP INDEX "places_identity_key";--> statement-breakpoint

-- Новое тождество не видит селекторов варианта, и места, которые старое различало («Кафе ☕» и
-- «Кафе ☕» с VS16), становятся одним. Без слияния CREATE UNIQUE INDEX упал бы на такой паре, а
-- миграции идут при старте — API не поднялся бы (MOL-21, атаки, заход 4, А). Сливаются так же,
-- как в 0007: в старейшую карточку.
--
-- Сначала вердикты, которые слияние сделало бы одной тройкой «владелец + позиция + место»:
-- остаётся последнее мнение — поздний updated_at (решение владельца 19.09.2026).
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(regexp_replace(normalize("city", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(regexp_replace(normalize("name", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
), collapsed AS (
  SELECT v."id", row_number() OVER (
    PARTITION BY v."actor_id", v."item_id", coalesce(r.keeper, v."place_id")
    ORDER BY v."updated_at" DESC, v."rated_at" DESC, v."id" DESC
  ) AS n
  FROM "verdicts" v LEFT JOIN ranked r ON r."id" = v."place_id"
)
DELETE FROM "verdicts" v USING collapsed c WHERE v."id" = c."id" AND c.n > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(regexp_replace(normalize("city", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(regexp_replace(normalize("name", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "trips" t SET "place_id" = r.keeper
FROM ranked r WHERE t."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(regexp_replace(normalize("city", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(regexp_replace(normalize("name", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
UPDATE "verdicts" v SET "place_id" = r.keeper
FROM ranked r WHERE v."place_id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "kind", "country", btrim(lower(regexp_replace(normalize("city", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'), btrim(lower(regexp_replace(normalize("name", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF')
    ORDER BY "created_at", "id"
  ) AS keeper
  FROM "places"
)
DELETE FROM "places" p USING ranked r WHERE p."id" = r."id" AND r.keeper <> r."id";--> statement-breakpoint
CREATE UNIQUE INDEX "places_identity_key" ON "places" USING btree ("kind","country",btrim(lower(regexp_replace(normalize("city", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'),btrim(lower(regexp_replace(normalize("name", NFKC), E'[\uFE00-\uFE0F\U000E0100-\U000E01EF]', '', 'g')), E' \t\r\n\u00A0\u200B\u200C\u200D\uFEFF'));