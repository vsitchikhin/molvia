ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "owner_notices" ADD COLUMN "feedback_id" bigint;--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_notices_feedback_idx" ON "owner_notices" USING btree ("feedback_id");--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_feedback_named" CHECK (("owner_notices"."kind" in ('feedback', 'feedback_continued')) = ("owner_notices"."feedback_id" is not null));--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'feedback', 'feedback_continued'));