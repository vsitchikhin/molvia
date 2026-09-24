-- Обмены владельца и его выбор источника курса (MOL-40). Каждый оператор переживает повтор: копия,
-- успевшая применить файл до того, как ветка его поправила, на нём не встанет (как 0015).
CREATE TABLE IF NOT EXISTS "exchanges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"given_minor" bigint NOT NULL,
	"given_currency" char(3) NOT NULL,
	"received_minor" bigint NOT NULL,
	"received_currency" char(3) NOT NULL,
	"exchanged_on" date NOT NULL,
	"held_before_minor" bigint,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exchanges_given_positive" CHECK ("exchanges"."given_minor" > 0),
	CONSTRAINT "exchanges_received_positive" CHECK ("exchanges"."received_minor" > 0),
	CONSTRAINT "exchanges_held_not_negative" CHECK ("exchanges"."held_before_minor" is null or "exchanges"."held_before_minor" >= 0),
	CONSTRAINT "exchanges_given_currency_known" CHECK ("exchanges"."given_currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "exchanges_received_currency_known" CHECK ("exchanges"."received_currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "exchanges_currencies_differ" CHECK ("exchanges"."given_currency" <> "exchanges"."received_currency")
);
--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN IF NOT EXISTS "rate_preference" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "exchanges" DROP CONSTRAINT IF EXISTS "exchanges_actor_id_actors_id_fk";--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchanges_actor_day_idx" ON "exchanges" USING btree ("actor_id","exchanged_on","created_at");--> statement-breakpoint
ALTER TABLE "actors" DROP CONSTRAINT IF EXISTS "actors_rate_preference_known";--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_rate_preference_known" CHECK ("actors"."rate_preference" in ('personal', 'official'));
