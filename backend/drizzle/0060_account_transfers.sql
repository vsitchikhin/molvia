-- A transfer between one's own accounts of one currency (MOL-253): it moves the two balances and
-- nothing else. Its fee is an ordinary spending pointing at it, so every reader of spendings counts it.
CREATE TABLE "account_transfer_revisions" (
	"transfer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"fee_minor" bigint,
	"transferred_on" date NOT NULL,
	"note" text,
	"replaced_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "account_transfer_revisions_transfer_id_revision_pk" PRIMARY KEY("transfer_id","revision"),
	CONSTRAINT "account_transfer_revisions_amount_positive" CHECK ("account_transfer_revisions"."amount_minor" > 0),
	CONSTRAINT "account_transfer_revisions_fee_positive" CHECK ("account_transfer_revisions"."fee_minor" is null or "account_transfer_revisions"."fee_minor" > 0),
	CONSTRAINT "account_transfer_revisions_currency_known" CHECK ("account_transfer_revisions"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL', 'RSD'))
);
--> statement-breakpoint
CREATE TABLE "account_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"transferred_on" date NOT NULL,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"amended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_transfers_id_actor_unique" UNIQUE("id","actor_id"),
	CONSTRAINT "account_transfers_two_accounts" CHECK ("account_transfers"."from_account_id" <> "account_transfers"."to_account_id"),
	CONSTRAINT "account_transfers_amount_positive" CHECK ("account_transfers"."amount_minor" > 0),
	CONSTRAINT "account_transfers_currency_known" CHECK ("account_transfers"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL', 'RSD')),
	CONSTRAINT "account_transfers_revision_positive" CHECK ("account_transfers"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "account_transfer_revisions" ADD CONSTRAINT "account_transfer_revisions_transfer_id_account_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."account_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_is_owners" FOREIGN KEY ("from_account_id","actor_id","currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_is_owners" FOREIGN KEY ("to_account_id","actor_id","currency") REFERENCES "public"."money_accounts"("id","actor_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_transfers_actor_day_idx" ON "account_transfers" USING btree ("actor_id","transferred_on","created_at");--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_transfer_is_owners" FOREIGN KEY ("transfer_id","actor_id") REFERENCES "public"."account_transfers"("id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_transfer_unique" UNIQUE("transfer_id");