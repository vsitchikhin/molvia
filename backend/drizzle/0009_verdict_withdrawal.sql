ALTER TABLE "verdicts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_deleted_after_rated" CHECK ("verdicts"."deleted_at" >= "verdicts"."rated_at");--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_withdrawn_without_review" CHECK ("verdicts"."deleted_at" is null or "verdicts"."review" is null);