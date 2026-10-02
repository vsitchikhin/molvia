ALTER TABLE "reminder_days" DROP CONSTRAINT "reminder_days_counts_non_negative";--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "reminders_off" text;--> statement-breakpoint
ALTER TABLE "reminder_days" ADD COLUMN "off_button" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_days" ADD COLUMN "off_settings" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_days" ADD COLUMN "off_blocked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_reminders_off_known" CHECK ("actors"."reminders_off" in ('chosen', 'blocked'));--> statement-breakpoint
ALTER TABLE "reminder_days" ADD CONSTRAINT "reminder_days_counts_non_negative" CHECK (least("reminder_days"."first_steps", "reminder_days"."second_steps", "reminder_days"."third_steps", "reminder_days"."items", "reminder_days"."rated", "reminder_days"."off_button", "reminder_days"."off_settings", "reminder_days"."off_blocked") >= 0);