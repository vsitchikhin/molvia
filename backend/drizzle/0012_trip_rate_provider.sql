-- Переписана 21.09.2026, до мержа: к бэкфиллу добавилась связь «источник ⟺ издатель». Копия,
-- которая успела применить прежнюю версию, получает новую запись в журнале (у файла новая
-- отметка времени) — и тогда операторы выполняются по второму разу. Поэтому каждый из них
-- переживает повтор: колонка «если ещё нет», ограничения снимаются перед тем, как встать
-- (раунд 3, Г6). Никакая правка после мержа так уже не делается — правило журнала.
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "rate_provider" text;--> statement-breakpoint
-- Походам, начатым до этой миграции, издателя ставим по источнику: «official» — это ЦБ РА и
-- никто другой (`pickOfficialRate`). Без этой строки CHECK ниже не лёг бы на такую строку, а
-- миграции идут при старте API — то есть API бы не поднялся (MOL-22, А2).
--
-- Снимок «fallback» до этой миграции восстановить нечем: провайдера тогда нигде не хранили. Ни в
-- одной копии таких строк нет (проверено перед добавлением колонки), продакшена нет — и это
-- единственное окно, когда такое условие допустимо: та же оговорка, что у алфавита MOL-11 и
-- `INVISIBLE` MOL-27.
UPDATE "trips" SET "rate_provider" = 'cba' WHERE "rate_source" = 'official';--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_rate_provider_known";--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_known" CHECK ("trips"."rate_provider" is null or "trips"."rate_provider" in ('cba', 'cbr', 'erapi'));--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_rate_provider_matches_source";--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_matches_source" CHECK (("trips"."rate_source" is null or "trips"."rate_source" = 'personal') = ("trips"."rate_provider" is null)
        and (("trips"."rate_source" = 'official') = ("trips"."rate_provider" = 'cba')) is not false);