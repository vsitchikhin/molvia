CREATE TABLE "login_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"secret_hash" char(64) NOT NULL,
	"device_name" varchar(80),
	"telegram_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "login_requests_code_key" UNIQUE("code"),
	CONSTRAINT "login_requests_code_format" CHECK ("login_requests"."code" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "login_requests_secret_hash_hex" CHECK ("login_requests"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_requests_lifetime_forward" CHECK ("login_requests"."expires_at" > "login_requests"."created_at"),
	CONSTRAINT "login_requests_telegram_user_id_positive" CHECK ("login_requests"."telegram_user_id" is null or "login_requests"."telegram_user_id" > 0),
	CONSTRAINT "login_requests_telegram_user_id_safe" CHECK ("login_requests"."telegram_user_id" is null or "login_requests"."telegram_user_id" < 9007199254740992)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"device_name" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_hex" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_lifetime_forward" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_actor_idx" ON "sessions" USING btree ("actor_id");