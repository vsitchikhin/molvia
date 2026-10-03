ALTER TABLE "feedback_replies" DROP CONSTRAINT "feedback_replies_delivered_known";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_in_reply_to_feedback_replies_id_fk";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_thread_is_owners";--> statement-breakpoint
ALTER TABLE "feedback_replies" DROP CONSTRAINT "feedback_replies_feedback_id_feedback_id_fk";--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "head" boolean GENERATED ALWAYS AS (thread_id is null) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "thread_head" boolean GENERATED ALWAYS AS (case when thread_id is not null then true end) STORED;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
UPDATE "feedback_replies" r SET "actor_id" = f."actor_id" FROM "feedback" f WHERE f."id" = r."feedback_id";--> statement-breakpoint
ALTER TABLE "feedback_replies" ALTER COLUMN "actor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD COLUMN "telegram_message_id" bigint;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_id_actor_head_key" UNIQUE("id","actor_id","head");--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_id_actor_key" UNIQUE("id","actor_id");--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_telegram_message_key" UNIQUE("actor_id","telegram_message_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_thread_is_owners" FOREIGN KEY ("thread_id","actor_id","thread_head") REFERENCES "public"."feedback"("id","actor_id","head") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_message_is_owners" FOREIGN KEY ("feedback_id","actor_id") REFERENCES "public"."feedback"("id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_answers_own_reply" FOREIGN KEY ("in_reply_to","actor_id") REFERENCES "public"."feedback_replies"("id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_continuation_answers" CHECK (("feedback"."thread_id" is null) = ("feedback"."in_reply_to" is null));--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_delivered_known" CHECK ("feedback_replies"."delivered" is null or "feedback_replies"."delivered" in ('sent', 'blocked'));
