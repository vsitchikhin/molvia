CREATE TABLE "rating_reminders" (
	"actor_id" uuid PRIMARY KEY NOT NULL,
	"step" smallint NOT NULL,
	"reminded_on" date NOT NULL,
	"reminded_at" timestamp with time zone NOT NULL,
	"window_from" date NOT NULL,
	CONSTRAINT "rating_reminders_step" CHECK ("rating_reminders"."step" between 1 and 3),
	CONSTRAINT "rating_reminders_window_before" CHECK ("rating_reminders"."window_from" < "rating_reminders"."reminded_on")
);
--> statement-breakpoint
CREATE TABLE "reminder_days" (
	"day" date PRIMARY KEY NOT NULL,
	"first_steps" integer DEFAULT 0 NOT NULL,
	"second_steps" integer DEFAULT 0 NOT NULL,
	"third_steps" integer DEFAULT 0 NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"rated" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reminder_days_counts_non_negative" CHECK (least("reminder_days"."first_steps", "reminder_days"."second_steps", "reminder_days"."third_steps", "reminder_days"."items", "reminder_days"."rated") >= 0)
);
--> statement-breakpoint
ALTER TABLE "rating_reminders" ADD CONSTRAINT "rating_reminders_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;