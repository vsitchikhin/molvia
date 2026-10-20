CREATE TABLE "model_spend" (
	"month" date PRIMARY KEY NOT NULL,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"noticed" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "model_spend_month_first_day" CHECK (extract(day from "model_spend"."month") = 1),
	CONSTRAINT "model_spend_non_negative" CHECK (least("model_spend"."spent_micro_usd", "model_spend"."calls") >= 0),
	CONSTRAINT "model_spend_noticed_step" CHECK ("model_spend"."noticed" in (0, 50, 90, 100))
);
--> statement-breakpoint
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend'));