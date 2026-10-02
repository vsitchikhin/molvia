CREATE TABLE "budget_plans" (
	"actor_id" uuid NOT NULL,
	"category_id" uuid,
	"from_month" char(7) NOT NULL,
	"amount_minor" bigint,
	"currency" char(3),
	"percent" smallint,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "budget_plans_actor_category_month_key" UNIQUE NULLS NOT DISTINCT("actor_id","category_id","from_month"),
	CONSTRAINT "budget_plans_month_shape" CHECK ("budget_plans"."from_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_plans_one_kind" CHECK (("budget_plans"."amount_minor" is null) = ("budget_plans"."currency" is null)
        and not ("budget_plans"."amount_minor" is not null and "budget_plans"."percent" is not null)),
	CONSTRAINT "budget_plans_amount_non_negative" CHECK ("budget_plans"."amount_minor" is null or "budget_plans"."amount_minor" >= 0),
	CONSTRAINT "budget_plans_currency_known" CHECK ("budget_plans"."currency" is null or "budget_plans"."currency" in ('AMD', 'RUB', 'USD', 'EUR')),
	CONSTRAINT "budget_plans_percent_range" CHECK ("budget_plans"."percent" is null or "budget_plans"."percent" between 0 and 100),
	CONSTRAINT "budget_plans_savings_is_share" CHECK ("budget_plans"."category_id" is not null or "budget_plans"."amount_minor" is null)
);
--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_category_is_owners" FOREIGN KEY ("category_id","actor_id") REFERENCES "public"."spending_categories"("id","actor_id") ON DELETE no action ON UPDATE no action;