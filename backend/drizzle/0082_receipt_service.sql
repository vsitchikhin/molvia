-- MOL-310. Обслуживание кафе (В-2 «а»): «Հավելավճար 10%» — не блюдо, строки дают итог без него, поход — итог. И
-- слип терминала без счёта (В-3 «а»): своя раскладка `slip`, итог из одного места. Только добавление: откат образа
-- читает колонку как пустую, а раскладку — как текст.
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_layout_known";--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "service_minor" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_service_positive" CHECK ("receipts"."service_minor" is null or "receipts"."service_minor" > 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_layout_known" CHECK ("receipts"."layout" is null or "receipts"."layout" in ('card', 'table', 'class', 'department', 'slip'));