-- The vectors of catalogue names, for search by meaning (MOL-105). One per item, of the model
-- named beside it; the HNSW index by cosine is what keeps a query from reading them all.
CREATE TABLE "item_embeddings" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"model" varchar(100) NOT NULL,
	"embedding" halfvec(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_embeddings" ADD CONSTRAINT "item_embeddings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_embeddings_hnsw_idx" ON "item_embeddings" USING hnsw ("embedding" halfvec_cosine_ops);