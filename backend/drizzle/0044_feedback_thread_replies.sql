ALTER TABLE "feedback" DROP CONSTRAINT "feedback_answers_own_reply";--> statement-breakpoint
ALTER TABLE "feedback_replies" DROP CONSTRAINT "feedback_replies_message_is_owners";--> statement-breakpoint
ALTER TABLE "feedback_replies" DROP CONSTRAINT "feedback_replies_id_actor_key";--> statement-breakpoint
ALTER TABLE "feedback_replies" DROP CONSTRAINT "feedback_replies_delivered_known";--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "thread_key" bigint GENERATED ALWAYS AS (coalesce(thread_id, id)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
UPDATE "feedback_replies" r SET "thread_id" = f."thread_key" FROM "feedback" f WHERE f."id" = r."feedback_id";--> statement-breakpoint
ALTER TABLE "feedback_replies" ALTER COLUMN "thread_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_notices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_notices" ADD COLUMN "tries" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_id_actor_thread_key" UNIQUE("id","actor_id","thread_key");--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_id_actor_thread_key" UNIQUE("id","actor_id","thread_id");--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_message_is_owners" FOREIGN KEY ("feedback_id","actor_id","thread_id") REFERENCES "public"."feedback"("id","actor_id","thread_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_answers_own_reply" FOREIGN KEY ("in_reply_to","actor_id","thread_key") REFERENCES "public"."feedback_replies"("id","actor_id","thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_delivered_known" CHECK ("feedback_replies"."delivered" is null or "feedback_replies"."delivered" in ('sent', 'blocked', 'failed'));
