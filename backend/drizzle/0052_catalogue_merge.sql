CREATE TABLE "catalogue_merge_candidates" (
	"subject" text NOT NULL,
	"a" uuid NOT NULL,
	"b" uuid NOT NULL,
	"named_on" date NOT NULL,
	CONSTRAINT "catalogue_merge_candidates_subject_a_b_pk" PRIMARY KEY("subject","a","b"),
	CONSTRAINT "catalogue_merge_candidates_subject_known" CHECK ("catalogue_merge_candidates"."subject" in ('item', 'place')),
	CONSTRAINT "catalogue_merge_candidates_ordered" CHECK ("catalogue_merge_candidates"."a" < "catalogue_merge_candidates"."b")
);
--> statement-breakpoint
CREATE TABLE "catalogue_merge_moves" (
	"merge_id" bigint NOT NULL,
	"what" text NOT NULL,
	"key" jsonb NOT NULL,
	"before" jsonb,
	"actor_id" uuid,
	CONSTRAINT "catalogue_merge_moves_what_known" CHECK ("catalogue_merge_moves"."what" in ('expense', 'verdict', 'verdict_displaced', 'verdict_withdrawn', 'trip', 'barcode', 'item_name', 'item_hs', 'store_memory', 'receipt_line', 'pick', 'pick_added', 'trace')),
	CONSTRAINT "catalogue_merge_moves_pick_named" CHECK (("catalogue_merge_moves"."actor_id" is not null) = ("catalogue_merge_moves"."what" in ('pick', 'pick_added')))
);
--> statement-breakpoint
CREATE TABLE "catalogue_merge_runs" (
	"day" date PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"report" jsonb,
	"reported_at" timestamp with time zone,
	CONSTRAINT "catalogue_merge_runs_mode_known" CHECK ("catalogue_merge_runs"."mode" in ('on', 'report'))
);
--> statement-breakpoint
CREATE TABLE "catalogue_merges" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalogue_merges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject" text NOT NULL,
	"from_item" uuid,
	"into_item" uuid,
	"from_place" uuid,
	"into_place" uuid,
	"by" text NOT NULL,
	"edits" smallint,
	"worst" smallint,
	"meaning" real,
	"merged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "catalogue_merges_subject_known" CHECK ("catalogue_merges"."subject" in ('item', 'place')),
	CONSTRAINT "catalogue_merges_by_known" CHECK ("catalogue_merges"."by" in ('night', 'hand')),
	CONSTRAINT "catalogue_merges_subject_named" CHECK (case "catalogue_merges"."subject" when 'item'
        then "catalogue_merges"."from_item" is not null and "catalogue_merges"."into_item" is not null
          and "catalogue_merges"."from_place" is null and "catalogue_merges"."into_place" is null
        else "catalogue_merges"."from_place" is not null and "catalogue_merges"."into_place" is not null
          and "catalogue_merges"."from_item" is null and "catalogue_merges"."into_item" is null end),
	CONSTRAINT "catalogue_merges_not_self" CHECK (coalesce("catalogue_merges"."from_item", "catalogue_merges"."from_place") <> coalesce("catalogue_merges"."into_item", "catalogue_merges"."into_place"))
);
--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_merge_id_catalogue_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."catalogue_merges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_merge_moves" ADD CONSTRAINT "catalogue_merge_moves_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_merges" ADD CONSTRAINT "catalogue_merges_from_item_items_id_fk" FOREIGN KEY ("from_item") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_merges" ADD CONSTRAINT "catalogue_merges_into_item_items_id_fk" FOREIGN KEY ("into_item") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_merges" ADD CONSTRAINT "catalogue_merges_from_place_places_id_fk" FOREIGN KEY ("from_place") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_merges" ADD CONSTRAINT "catalogue_merges_into_place_places_id_fk" FOREIGN KEY ("into_place") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_merge_moves_merge_idx" ON "catalogue_merge_moves" USING btree ("merge_id");--> statement-breakpoint
CREATE INDEX "catalogue_merge_moves_actor_idx" ON "catalogue_merge_moves" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_merges_item_live" ON "catalogue_merges" USING btree ("from_item") WHERE "catalogue_merges"."undone_at" is null and "catalogue_merges"."from_item" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_merges_place_live" ON "catalogue_merges" USING btree ("from_place") WHERE "catalogue_merges"."undone_at" is null and "catalogue_merges"."from_place" is not null;--> statement-breakpoint
CREATE INDEX "catalogue_merges_into_item_idx" ON "catalogue_merges" USING btree ("into_item");--> statement-breakpoint
CREATE INDEX "catalogue_merges_into_place_idx" ON "catalogue_merges" USING btree ("into_place");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_merged_into_items_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_merged_into_places_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_merged_into_idx" ON "items" USING btree ("merged_into") WHERE "items"."merged_into" is not null;--> statement-breakpoint
CREATE INDEX "places_merged_into_idx" ON "places" USING btree ("merged_into") WHERE "places"."merged_into" is not null;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_merged_not_self" CHECK ("items"."merged_into" <> "items"."id");--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged'));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_merged_not_self" CHECK ("places"."merged_into" <> "places"."id");--> statement-breakpoint
-- MOL-106: вердикт, перенесённый склейкой близнецов, сохраняет свой момент. По «обновлено»
-- сортируется «Что брать», а склейка — не новое мнение человека. Склейка говорит это только
-- внутри своей транзакции (`set local molvia.merging = 'on'`); любая другая правка двигает
-- колонку, как раньше.
CREATE OR REPLACE FUNCTION "verdicts_set_updated_at"() RETURNS trigger AS $$
BEGIN
  IF current_setting('molvia.merging', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW."updated_at" = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER "verdicts_touch_updated_at" ON "verdicts";--> statement-breakpoint
CREATE TRIGGER "verdicts_touch_updated_at" BEFORE UPDATE ON "verdicts"
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION "verdicts_set_updated_at"();
