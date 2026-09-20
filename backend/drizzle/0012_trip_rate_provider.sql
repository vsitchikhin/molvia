ALTER TABLE "trips" ADD COLUMN "rate_provider" text;--> statement-breakpoint
-- Походам, начатым до этой миграции, издателя ставим по источнику: «official» — это ЦБ РА и
-- никто другой (`pickOfficialRate`). Без этой строки CHECK ниже не лёг бы на такую строку, а
-- миграции идут при старте API — то есть API бы не поднялся (MOL-22, А2).
--
-- Снимок «fallback» до этой миграции восстановить нечем: провайдера тогда нигде не хранили. Ни в
-- одной копии таких строк нет (проверено перед добавлением колонки), продакшена нет — и это
-- единственное окно, когда такое условие допустимо: та же оговорка, что у алфавита MOL-11 и
-- `INVISIBLE` MOL-27.
UPDATE "trips" SET "rate_provider" = 'cba' WHERE "rate_source" = 'official';--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_known" CHECK ("trips"."rate_provider" is null or "trips"."rate_provider" in ('cba', 'cbr', 'erapi'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_matches_source" CHECK (("trips"."rate_source" is null or "trips"."rate_source" = 'personal') = ("trips"."rate_provider" is null)
        and (("trips"."rate_source" = 'official') = ("trips"."rate_provider" = 'cba')) is not false);