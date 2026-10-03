CREATE TABLE "failures" (
	"fingerprint" char(64) PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"error_name" text NOT NULL,
	"code" text,
	"route" text,
	"frames" text[] NOT NULL,
	"build" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"build_count" integer NOT NULL,
	CONSTRAINT "failures_fingerprint_hex" CHECK ("failures"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "failures_source_known" CHECK ("failures"."source" in ('api', 'bot')),
	CONSTRAINT "failures_lengths" CHECK (char_length("failures"."error_name") between 1 and 64
          and ("failures"."code" is null or char_length("failures"."code") <= 64)
          and ("failures"."route" is null or char_length("failures"."route") <= 200)
          and cardinality("failures"."frames") <= 8),
	CONSTRAINT "failures_counts" CHECK ("failures"."count" >= "failures"."build_count" and "failures"."build_count" >= 1),
	CONSTRAINT "failures_seen_forward" CHECK ("failures"."last_seen_at" >= "failures"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "owner_notices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "owner_notices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"handed_at" timestamp with time zone,
	CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count')),
	CONSTRAINT "owner_notices_payload_object" CHECK (jsonb_typeof("owner_notices"."payload") = 'object'),
	CONSTRAINT "owner_notices_payload_kind" CHECK ("owner_notices"."payload" ->> 'kind' = "owner_notices"."kind")
);
--> statement-breakpoint
CREATE INDEX "failures_last_seen_at" ON "failures" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "owner_notices_waiting" ON "owner_notices" USING btree ("id") WHERE "owner_notices"."handed_at" is null;