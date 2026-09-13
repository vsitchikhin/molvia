CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"place_id" uuid,
	"score" smallint NOT NULL,
	"review" varchar(500),
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_actor_item_place_key" UNIQUE NULLS NOT DISTINCT("actor_id","item_id","place_id"),
	CONSTRAINT "verdicts_score_range" CHECK ("verdicts"."score" between 1 and 5),
	CONSTRAINT "verdicts_updated_after_rated" CHECK ("verdicts"."updated_at" >= "verdicts"."rated_at")
);
--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verdicts_item_idx" ON "verdicts" USING btree ("item_id");