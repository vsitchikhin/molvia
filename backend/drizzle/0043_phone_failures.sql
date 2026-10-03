ALTER TABLE "failures" DROP CONSTRAINT "failures_source_known";--> statement-breakpoint
ALTER TABLE "failures" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_platform_phone" CHECK (("failures"."platform" is not null) = ("failures"."source" = 'phone')
          and ("failures"."platform" is null or char_length("failures"."platform") <= 32));--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_source_known" CHECK ("failures"."source" in ('api', 'bot', 'phone'));