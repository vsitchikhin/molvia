-- Правка обмена с историей и заметка (MOL-42, В-3, В-4): прежние версии обмена — строки
-- exchange_revisions, уходят вместе с обменом. Каждый оператор переживает повтор (как 0017).
CREATE TABLE IF NOT EXISTS "exchange_revisions" (
	"exchange_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"given_minor" bigint NOT NULL,
	"given_currency" char(3) NOT NULL,
	"received_minor" bigint NOT NULL,
	"received_currency" char(3) NOT NULL,
	"exchanged_on" date NOT NULL,
	"held_before_minor" bigint,
	"note" text,
	"replaced_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exchange_revisions_exchange_id_revision_pk" PRIMARY KEY("exchange_id","revision"),
	CONSTRAINT "exchange_revisions_given_positive" CHECK ("exchange_revisions"."given_minor" > 0),
	CONSTRAINT "exchange_revisions_received_positive" CHECK ("exchange_revisions"."received_minor" > 0),
	CONSTRAINT "exchange_revisions_given_currency_known" CHECK ("exchange_revisions"."given_currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "exchange_revisions_received_currency_known" CHECK ("exchange_revisions"."received_currency" in ('AMD', 'RUB', 'USD', 'EUR'))
);
--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN IF NOT EXISTS "amended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_revisions" DROP CONSTRAINT IF EXISTS "exchange_revisions_exchange_id_exchanges_id_fk";--> statement-breakpoint
ALTER TABLE "exchange_revisions" ADD CONSTRAINT "exchange_revisions_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" DROP CONSTRAINT IF EXISTS "exchanges_revision_positive";--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_revision_positive" CHECK ("exchanges"."revision" > 0);