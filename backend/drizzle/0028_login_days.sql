CREATE TABLE "login_days" (
	"day" date PRIMARY KEY NOT NULL,
	"started" integer DEFAULT 0 NOT NULL,
	"again" integer DEFAULT 0 NOT NULL,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"declined" integer DEFAULT 0 NOT NULL,
	"collected" integer DEFAULT 0 NOT NULL,
	"expired_unconfirmed" integer DEFAULT 0 NOT NULL,
	"expired_confirmed" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "login_days_counts_non_negative" CHECK (least("login_days"."started", "login_days"."again", "login_days"."confirmed", "login_days"."declined", "login_days"."collected", "login_days"."expired_unconfirmed", "login_days"."expired_confirmed", "login_days"."refused") >= 0),
	CONSTRAINT "login_days_again_within_started" CHECK ("login_days"."again" <= "login_days"."started")
);
--> statement-breakpoint
-- Logins already in flight when the count begins (review А3): their outcome is counted from now
-- on, so their start is counted here — and their «Войти», if the bot has had it — on the day each
-- began, as `yerevanDay` reads it. A request already put out has its outcome behind it and no
-- count to come.
INSERT INTO "login_days" ("day", "started", "confirmed")
SELECT (("created_at" at time zone 'UTC') + interval '4 hours')::date,
	count(*)::int,
	(count(*) FILTER (WHERE "telegram_user_id" IS NOT NULL))::int
FROM "login_requests"
WHERE "consumed_at" IS NULL
GROUP BY 1;
