-- MOL-299 (адверсариальное К1, решение владельца В-11 «б»): выбор в поиске, который id следа прибавил к строке
-- выжившей, не названной ни одним ходом его пути, — ход журнала с долей следа и тем, что строка держала до неё;
-- отмена уносит долю домой. Называет человека и уходит с ним каскадом.
ALTER TABLE "catalogue_merge_moves" DROP CONSTRAINT "catalogue_merge_moves_what_known";--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" DROP CONSTRAINT "catalogue_merge_moves_pick_named";--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_what_known" CHECK ("catalogue_merge_moves"."what" in ('expense', 'verdict', 'verdict_swapped', 'verdict_withdrawn', 'trip', 'barcode', 'item_name', 'item_hs', 'store_memory', 'receipt_line', 'pick', 'pick_added', 'trace', 'verdict_overwritten', 'pick_written'));--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_pick_named" CHECK (("catalogue_merge_moves"."actor_id" is not null) = ("catalogue_merge_moves"."what" in ('pick', 'pick_added', 'verdict_overwritten', 'pick_written')));