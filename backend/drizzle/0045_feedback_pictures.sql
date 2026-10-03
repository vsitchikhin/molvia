CREATE TABLE "feedback_pictures" (
	"feedback_id" bigint NOT NULL,
	"position" smallint NOT NULL,
	"source" text NOT NULL,
	"image" "bytea",
	"telegram_file_id" text,
	"fingerprint" text NOT NULL,
	"bytes" integer,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "feedback_pictures_feedback_id_position_pk" PRIMARY KEY("feedback_id","position"),
	CONSTRAINT "feedback_pictures_position_range" CHECK ("feedback_pictures"."position" between 1 and 3),
	CONSTRAINT "feedback_pictures_source_known" CHECK ("feedback_pictures"."source" in ('phone', 'telegram')),
	CONSTRAINT "feedback_pictures_kept_by_source" CHECK (("feedback_pictures"."source" = 'phone' or "feedback_pictures"."image" is null)
          and ("feedback_pictures"."source" = 'telegram' or "feedback_pictures"."telegram_file_id" is null)),
	CONSTRAINT "feedback_pictures_image_size" CHECK ("feedback_pictures"."image" is null
          or octet_length("feedback_pictures"."image") between 1 and 2097152),
	CONSTRAINT "feedback_pictures_bytes_size" CHECK ("feedback_pictures"."bytes" is null or "feedback_pictures"."bytes" > 0),
	CONSTRAINT "feedback_pictures_sides_positive" CHECK ("feedback_pictures"."width" > 0 and "feedback_pictures"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "pictures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_pictures" ADD CONSTRAINT "feedback_pictures_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_pictures_held_idx" ON "feedback_pictures" USING btree ("created_at") WHERE "feedback_pictures"."image" is not null or "feedback_pictures"."telegram_file_id" is not null;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_says_something" CHECK ("feedback"."text" <> '' or "feedback"."pictures" > 0);--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_pictures_range" CHECK ("feedback"."pictures" between 0 and 3);