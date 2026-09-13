CREATE TABLE "search_picks" (
	"actor_id" uuid NOT NULL,
	"query_key" varchar(800) NOT NULL,
	"item_id" uuid NOT NULL,
	"picks" integer DEFAULT 1 NOT NULL,
	"last_picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_picks_actor_id_query_key_item_id_pk" PRIMARY KEY("actor_id","query_key","item_id"),
	CONSTRAINT "search_picks_counted" CHECK ("search_picks"."picks" > 0)
);
--> statement-breakpoint
ALTER TABLE "search_picks" ADD CONSTRAINT "search_picks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_picks" ADD CONSTRAINT "search_picks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;