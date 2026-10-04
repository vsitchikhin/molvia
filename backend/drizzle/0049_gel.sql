-- The lari (MOL-110): every check that names the currencies takes `GEL`, every one that names the
-- providers takes `nbg`, and a trip's source matches the pair's own bank — the National Bank of
-- Georgia for a pair with the lari, the Central Bank of Armenia for the rest. The market keeps the
-- currencies of the central bank's files, which carry no lari. No row changes: every trip before
-- this migration is a pair without the lari, so its check reads exactly as before.
ALTER TABLE "actors" DROP CONSTRAINT "actors_spend_currency_known";--> statement-breakpoint
ALTER TABLE "actors" DROP CONSTRAINT "actors_income_currency_known";--> statement-breakpoint
ALTER TABLE "budget_plans" DROP CONSTRAINT "budget_plans_currency_known";--> statement-breakpoint
ALTER TABLE "exchange_revisions" DROP CONSTRAINT "exchange_revisions_given_currency_known";--> statement-breakpoint
ALTER TABLE "exchange_revisions" DROP CONSTRAINT "exchange_revisions_received_currency_known";--> statement-breakpoint
ALTER TABLE "exchanges" DROP CONSTRAINT "exchanges_given_currency_known";--> statement-breakpoint
ALTER TABLE "exchanges" DROP CONSTRAINT "exchanges_received_currency_known";--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_amount_currency_known";--> statement-breakpoint
ALTER TABLE "income_revisions" DROP CONSTRAINT "income_revisions_currency_known";--> statement-breakpoint
ALTER TABLE "incomes" DROP CONSTRAINT "incomes_currency_known";--> statement-breakpoint
ALTER TABLE "market_rates" DROP CONSTRAINT "market_rates_currency_foreign";--> statement-breakpoint
ALTER TABLE "money_accounts" DROP CONSTRAINT "money_accounts_currency_known";--> statement-breakpoint
ALTER TABLE "money_month_rates" DROP CONSTRAINT "money_month_rates_base_known";--> statement-breakpoint
ALTER TABLE "money_month_rates" DROP CONSTRAINT "money_month_rates_quote_known";--> statement-breakpoint
ALTER TABLE "official_rates" DROP CONSTRAINT "official_rates_provider_known";--> statement-breakpoint
ALTER TABLE "official_rates" DROP CONSTRAINT "official_rates_currency_foreign";--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_currency_known";--> statement-breakpoint
ALTER TABLE "spendings" DROP CONSTRAINT "spendings_currency_known";--> statement-breakpoint
ALTER TABLE "spendings" DROP CONSTRAINT "spendings_debited_currency_known";--> statement-breakpoint
ALTER TABLE "spendings" DROP CONSTRAINT "spendings_rate_quote_known";--> statement-breakpoint
ALTER TABLE "store_memory" DROP CONSTRAINT "store_memory_currency_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_currency_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_base_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_quote_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_provider_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_rate_provider_matches_source";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_receipt_currency_known";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_debited_currency_known";--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_spend_currency_known" CHECK ("actors"."spend_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_income_currency_known" CHECK ("actors"."income_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_currency_known" CHECK ("budget_plans"."currency" is null or "budget_plans"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "exchange_revisions" ADD CONSTRAINT "exchange_revisions_given_currency_known" CHECK ("exchange_revisions"."given_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "exchange_revisions" ADD CONSTRAINT "exchange_revisions_received_currency_known" CHECK ("exchange_revisions"."received_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_given_currency_known" CHECK ("exchanges"."given_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_received_currency_known" CHECK ("exchanges"."received_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_currency_known" CHECK ("expenses"."amount_currency" is null or "expenses"."amount_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "income_revisions" ADD CONSTRAINT "income_revisions_currency_known" CHECK ("income_revisions"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_currency_known" CHECK ("incomes"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "market_rates" ADD CONSTRAINT "market_rates_currency_foreign" CHECK ("market_rates"."currency" in ('RUB', 'USD', 'EUR'));--> statement-breakpoint
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_currency_known" CHECK ("money_accounts"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "money_month_rates" ADD CONSTRAINT "money_month_rates_base_known" CHECK ("money_month_rates"."base" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "money_month_rates" ADD CONSTRAINT "money_month_rates_quote_known" CHECK ("money_month_rates"."quote" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "official_rates" ADD CONSTRAINT "official_rates_provider_known" CHECK ("official_rates"."provider" in ('cba', 'cbr', 'erapi', 'nbg'));--> statement-breakpoint
ALTER TABLE "official_rates" ADD CONSTRAINT "official_rates_currency_foreign" CHECK ("official_rates"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL') and "official_rates"."currency" <> 'AMD');--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_currency_known" CHECK ("receipts"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_currency_known" CHECK ("spendings"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_debited_currency_known" CHECK ("spendings"."debited_currency" is null or "spendings"."debited_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_rate_quote_known" CHECK ("spendings"."rate_quote" is null or "spendings"."rate_quote" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "store_memory" ADD CONSTRAINT "store_memory_currency_known" CHECK ("store_memory"."price_currency" is null or "store_memory"."price_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_currency_known" CHECK ("trips"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_base_known" CHECK ("trips"."rate_base" is null or "trips"."rate_base" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_quote_known" CHECK ("trips"."rate_quote" is null or "trips"."rate_quote" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_known" CHECK ("trips"."rate_provider" is null or "trips"."rate_provider" in ('cba', 'cbr', 'erapi', 'nbg'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rate_provider_matches_source" CHECK (("trips"."rate_source" is null or "trips"."rate_source" = 'personal') = ("trips"."rate_provider" is null)
        and (("trips"."rate_source" = 'official') = ("trips"."rate_provider" = (case when "trips"."rate_base" = 'GEL' or "trips"."rate_quote" = 'GEL' then 'nbg' else 'cba' end))) is not false);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_receipt_currency_known" CHECK ("trips"."receipt_currency" is null or "trips"."receipt_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_debited_currency_known" CHECK ("trips"."debited_currency" is null or "trips"."debited_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL'));