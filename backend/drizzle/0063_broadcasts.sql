CREATE TABLE "broadcasts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"text" text NOT NULL,
	"countries" char(2)[],
	"owner_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"total" integer NOT NULL,
	"blocked_at_start" integer NOT NULL,
	"cursor" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"lease_until" timestamp with time zone,
	"sent" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "broadcasts_text_present" CHECK (char_length("broadcasts"."text") between 1 and 4096),
	CONSTRAINT "broadcasts_audience_one" CHECK ("broadcasts"."countries" is null
          or (cardinality("broadcasts"."countries") >= 1 and not "broadcasts"."owner_only")),
	CONSTRAINT "broadcasts_counts_non_negative" CHECK ("broadcasts"."total" >= 0 and "broadcasts"."blocked_at_start" >= 0
          and "broadcasts"."sent" >= 0 and "broadcasts"."blocked" >= 0 and "broadcasts"."failed" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_one_going" ON "broadcasts" USING btree ("owner_only") WHERE "broadcasts"."finished_at" is null and "broadcasts"."cancelled_at" is null and not "broadcasts"."owner_only";