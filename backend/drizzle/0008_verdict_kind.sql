-- Правка руками, два места, оба генератор знать не мог.
--
-- 1. Порядок. Сгенерировано было так, что внешний ключ на пару (id, kind) ставится раньше,
--    чем сама уникальность по этой паре, — Postgres на это отвечает отказом. Уникальность
--    поднята наверх.
-- 2. Заполнение колонки. `ADD COLUMN ... NOT NULL` не встанет на таблице со строками,
--    а вид позиции у уже записанного вердикта известен — он лежит в items. Колонка
--    добавляется пустой, заполняется из справочника и только потом становится обязательной.
ALTER TABLE "items" ADD CONSTRAINT "items_id_kind_key" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "verdicts" DROP CONSTRAINT "verdicts_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "item_kind" text;--> statement-breakpoint
UPDATE "verdicts" v SET "item_kind" = i."kind" FROM "items" i WHERE i."id" = v."item_id";--> statement-breakpoint
ALTER TABLE "verdicts" ALTER COLUMN "item_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_item_id_kind_fk" FOREIGN KEY ("item_id","item_kind") REFERENCES "public"."items"("id","kind") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_place_matches_kind" CHECK (("verdicts"."item_kind" = 'product') = ("verdicts"."place_id" is null));
