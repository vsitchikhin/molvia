-- MOL-400. Категория похода: выбирается на «Записать» и «Закончить», меняется в «Тратах». Пусто — «Продукты», как
-- было со всеми походами. Ключ — пара с владельцем, как у траты. Только добавление: откат образа колонку не читает.
ALTER TABLE "trips" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_category_is_owners" FOREIGN KEY ("category_id","actor_id") REFERENCES "public"."spending_categories"("id","actor_id") ON DELETE no action ON UPDATE no action;