-- Which edition of the terms and the privacy page an owner accepted, and when (MOL-95). Empty for
-- every owner before this migration: they pass the consent screen once.
ALTER TABLE "actors" ADD COLUMN "consent_version" smallint;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_consent_whole" CHECK (("actors"."consent_version" is null) = ("actors"."consented_at" is null));--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_consent_version_positive" CHECK ("actors"."consent_version" >= 1);