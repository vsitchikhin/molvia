CREATE TABLE "money_account_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"fact_minor" bigint NOT NULL,
	"counted_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"savings" boolean DEFAULT false NOT NULL,
	"start_minor" bigint NOT NULL,
	"start_on" date NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "money_accounts_id_actor_unique" UNIQUE("id","actor_id"),
	CONSTRAINT "money_accounts_id_actor_currency_unique" UNIQUE("id","actor_id","currency"),
	CONSTRAINT "money_accounts_currency_known" CHECK ("money_accounts"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "money_accounts_revision_positive" CHECK ("money_accounts"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN "given_account_id" uuid;--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN "received_account_id" uuid;--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN "account_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "account_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "debited_minor" bigint;--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "debited_currency" char(3);--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "account_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "debited_minor" bigint;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "debited_currency" char(3);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "account_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_account_checks" ADD CONSTRAINT "money_account_checks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_account_checks" ADD CONSTRAINT "money_account_checks_account_is_owners" FOREIGN KEY ("account_id","actor_id") REFERENCES "public"."money_accounts"("id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_account_checks_account_idx" ON "money_account_checks" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "money_accounts_actor_idx" ON "money_accounts" USING btree ("actor_id","created_at");--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_given_account_is_owners" FOREIGN KEY ("given_account_id","actor_id","given_currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_received_account_is_owners" FOREIGN KEY ("received_account_id","actor_id","received_currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_account_is_owners" FOREIGN KEY ("account_id","actor_id","currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_account_is_owners" FOREIGN KEY ("account_id","actor_id") REFERENCES "public"."money_accounts"("id","actor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_of_account_currency" FOREIGN KEY ("account_id","actor_id","debited_currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_account_is_owners" FOREIGN KEY ("account_id","actor_id") REFERENCES "public"."money_accounts"("id","actor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_debited_of_account_currency" FOREIGN KEY ("account_id","actor_id","debited_currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_whole" CHECK (num_nonnulls("spendings"."debited_minor", "spendings"."debited_currency") in (0, 2));--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_needs_account" CHECK ("spendings"."debited_minor" is null or ("spendings"."account_id" is not null and "spendings"."debited_minor" > 0));--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_in_other_currency" CHECK ("spendings"."debited_currency" is null or "spendings"."debited_currency" <> "spendings"."currency");--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_currency_known" CHECK ("spendings"."debited_currency" is null or "spendings"."debited_currency" in ('AMD', 'RUB', 'USD', 'EUR'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_debited_whole" CHECK (num_nonnulls("trips"."debited_minor", "trips"."debited_currency") in (0, 2));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_debited_needs_account" CHECK ("trips"."debited_minor" is null or ("trips"."account_id" is not null and "trips"."debited_minor" > 0));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_debited_currency_known" CHECK ("trips"."debited_currency" is null or "trips"."debited_currency" in ('AMD', 'RUB', 'USD', 'EUR'));