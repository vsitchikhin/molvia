-- MOL-374 (В-7 «а»). Когда автор товара удалил свои данные: стирание метит товар, уборка минутного таймера
-- удаляет его, когда на нём не стоит ни один живой человек. Только добавление: откат образа колонку не читает.
ALTER TABLE "items" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "items_released_idx" ON "items" USING btree ("released_at") WHERE "items"."released_at" is not null;