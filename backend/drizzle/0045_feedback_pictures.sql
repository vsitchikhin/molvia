CREATE TABLE "feedback_picture_files" (
	"feedback_id" bigint NOT NULL,
	"position" smallint NOT NULL,
	"image" "bytea",
	"telegram_file_id" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "feedback_picture_files_feedback_id_position_pk" PRIMARY KEY("feedback_id","position"),
	CONSTRAINT "feedback_picture_files_one_source" CHECK (("feedback_picture_files"."image" is null) <> ("feedback_picture_files"."telegram_file_id" is null)),
	CONSTRAINT "feedback_picture_files_image_size" CHECK ("feedback_picture_files"."image" is null
          or octet_length("feedback_picture_files"."image") between 1 and 2097152)
);
--> statement-breakpoint
CREATE TABLE "feedback_pictures" (
	"feedback_id" bigint NOT NULL,
	"position" smallint NOT NULL,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL,
	"bytes" integer,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "feedback_pictures_feedback_id_position_pk" PRIMARY KEY("feedback_id","position"),
	CONSTRAINT "feedback_pictures_position_range" CHECK ("feedback_pictures"."position" between 1 and 3),
	CONSTRAINT "feedback_pictures_source_known" CHECK ("feedback_pictures"."source" in ('phone', 'telegram')),
	CONSTRAINT "feedback_pictures_bytes_size" CHECK ("feedback_pictures"."bytes" is null or "feedback_pictures"."bytes" > 0),
	CONSTRAINT "feedback_pictures_sides_positive" CHECK ("feedback_pictures"."width" > 0 and "feedback_pictures"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "pictures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_picture_files" ADD CONSTRAINT "feedback_picture_files_line" FOREIGN KEY ("feedback_id","position") REFERENCES "public"."feedback_pictures"("feedback_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_pictures" ADD CONSTRAINT "feedback_pictures_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_picture_files_created_idx" ON "feedback_picture_files" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_says_something" CHECK ("feedback"."text" <> '' or "feedback"."pictures" > 0);--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_pictures_range" CHECK ("feedback"."pictures" between 0 and 3);