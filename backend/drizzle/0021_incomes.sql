-- Доходы владельца и прежние версии их правок (MOL-66): приватны, как обмены, и уходят вместе с
-- владельцем. Каждый оператор переживает повтор (как 0017 и 0020).
CREATE TABLE IF NOT EXISTS "income_revisions" (
	"income_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"received_on" date NOT NULL,
	"held_before_minor" bigint,
	"source" text NOT NULL,
	"note" text,
	"replaced_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "income_revisions_income_id_revision_pk" PRIMARY KEY("income_id","revision"),
	CONSTRAINT "income_revisions_amount_positive" CHECK ("income_revisions"."amount_minor" > 0),
	CONSTRAINT "income_revisions_currency_known" CHECK ("income_revisions"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "income_revisions_source_known" CHECK ("income_revisions"."source" in ('salary', 'bonus', 'freelance', 'debt_return', 'sale', 'gift', 'interest', 'brought', 'other'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"received_on" date NOT NULL,
	"held_before_minor" bigint,
	"source" text NOT NULL,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"amended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "incomes_amount_positive" CHECK ("incomes"."amount_minor" > 0),
	CONSTRAINT "incomes_held_not_negative" CHECK ("incomes"."held_before_minor" is null or "incomes"."held_before_minor" >= 0),
	CONSTRAINT "incomes_currency_known" CHECK ("incomes"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "incomes_source_known" CHECK ("incomes"."source" in ('salary', 'bonus', 'freelance', 'debt_return', 'sale', 'gift', 'interest', 'brought', 'other')),
	CONSTRAINT "incomes_revision_positive" CHECK ("incomes"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "income_revisions" DROP CONSTRAINT IF EXISTS "income_revisions_income_id_incomes_id_fk";--> statement-breakpoint
ALTER TABLE "income_revisions" ADD CONSTRAINT "income_revisions_income_id_incomes_id_fk" FOREIGN KEY ("income_id") REFERENCES "public"."incomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" DROP CONSTRAINT IF EXISTS "incomes_actor_id_actors_id_fk";--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incomes_actor_day_idx" ON "incomes" USING btree ("actor_id","received_on","created_at");