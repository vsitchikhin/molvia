ALTER TABLE "item_barcodes" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD COLUMN "added_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_added_by_actors_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;