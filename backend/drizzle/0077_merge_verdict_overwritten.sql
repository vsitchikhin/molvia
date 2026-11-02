-- MOL-299 (адверсариальное Г1, Г2, решение владельца В-10 «б»): своя оценка выжившей, которую после склейки
-- переписала запись по id следа, — ход журнала с прежним баллом и моментами, без текста; отмена возвращает их.
-- Ход называет человека и уходит с ним каскадом, как выбор в поиске.
ALTER TABLE "catalogue_merge_moves" DROP CONSTRAINT "catalogue_merge_moves_what_known";--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" DROP CONSTRAINT "catalogue_merge_moves_pick_named";--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_what_known" CHECK ("catalogue_merge_moves"."what" in ('expense', 'verdict', 'verdict_swapped', 'verdict_withdrawn', 'trip', 'barcode', 'item_name', 'item_hs', 'store_memory', 'receipt_line', 'pick', 'pick_added', 'trace', 'verdict_overwritten'));--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_pick_named" CHECK (("catalogue_merge_moves"."actor_id" is not null) = ("catalogue_merge_moves"."what" in ('pick', 'pick_added', 'verdict_overwritten')));