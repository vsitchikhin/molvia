CREATE TABLE "feedback" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"locale" text NOT NULL,
	"page_build" text,
	"api_build" text NOT NULL,
	"route" text,
	"platform" text,
	"error_code" text,
	"from_error" boolean DEFAULT false NOT NULL,
	"thread_id" bigint,
	"in_reply_to" bigint,
	"client_key" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "feedback_actor_client_key" UNIQUE("actor_id","client_key"),
	CONSTRAINT "feedback_id_actor_key" UNIQUE("id","actor_id"),
	CONSTRAINT "feedback_kind_known" CHECK ("feedback"."kind" in ('bug', 'idea', 'other')),
	CONSTRAINT "feedback_locale_known" CHECK ("feedback"."locale" in ('ru', 'en')),
	CONSTRAINT "feedback_code_from_error" CHECK ("feedback"."error_code" is null or "feedback"."from_error"),
	CONSTRAINT "feedback_thread_not_itself" CHECK ("feedback"."thread_id" is null or "feedback"."thread_id" < "feedback"."id")
);
--> statement-breakpoint
CREATE TABLE "feedback_replies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feedback_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feedback_id" bigint NOT NULL,
	"text" text NOT NULL,
	"delivered" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "feedback_replies_delivered_known" CHECK ("feedback_replies"."delivered" is null or "feedback_replies"."delivered" in ('sent', 'blocked', 'gone'))
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_in_reply_to_feedback_replies_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."feedback_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_thread_is_owners" FOREIGN KEY ("thread_id","actor_id") REFERENCES "public"."feedback"("id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_actor_created_idx" ON "feedback" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_thread_idx" ON "feedback" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "feedback_replies_feedback_idx" ON "feedback_replies" USING btree ("feedback_id");