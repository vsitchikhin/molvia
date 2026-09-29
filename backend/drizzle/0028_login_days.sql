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
