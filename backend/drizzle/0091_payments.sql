-- MOL-283. Журнал платежей — общий для всех каналов (Америабанк — MOL-277): тариф, якорь в долларах, курс дня, драмы,
-- номер заказа целым числом, состояние и номера канала. Стирание отвязывает платёж от человека (set null) — договор
-- банка, п. 3.9, держит записи три года. Только добавление: откат образа таблицу не читает.
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_no" bigint GENERATED ALWAYS AS IDENTITY (sequence name "payments_order_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"tariff" text NOT NULL,
	"anchor_minor" bigint NOT NULL,
	"anchor_currency" char(3) NOT NULL,
	"rate_scaled" bigint NOT NULL,
	"rate_day" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"channel" text NOT NULL,
	"channel_ref" text,
	"state" text DEFAULT 'created' NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"rrn" text,
	"approval_code" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"moved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payments_tariff_known" CHECK ("payments"."tariff" in ('data', 'receipts', 'both', 'tip')),
	CONSTRAINT "payments_state_known" CHECK ("payments"."state" in ('created', 'paid', 'declined', 'abandoned', 'refunded')),
	CONSTRAINT "payments_channel_known" CHECK ("payments"."channel" in ('ameriabank')),
	CONSTRAINT "payments_currency_known" CHECK ("payments"."currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL', 'RSD')),
	CONSTRAINT "payments_anchor_currency_known" CHECK ("payments"."anchor_currency" in ('AMD', 'RUB', 'USD', 'EUR', 'GEL', 'RSD')),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0 and "payments"."anchor_minor" > 0),
	CONSTRAINT "payments_rate_positive" CHECK ("payments"."rate_scaled" > 0),
	CONSTRAINT "payments_refunded_within" CHECK ("payments"."refunded_minor" between 0 and "payments"."amount_minor"),
	CONSTRAINT "payments_paid_at_whole" CHECK (("payments"."paid_at" is not null) = ("payments"."state" in ('paid', 'refunded'))),
	CONSTRAINT "payments_closed_at_whole" CHECK (("payments"."closed_at" is not null) = ("payments"."state" in ('declined', 'abandoned', 'refunded'))),
	CONSTRAINT "payments_refunded_whole" CHECK (("payments"."state" = 'refunded') = ("payments"."refunded_minor" = "payments"."amount_minor"))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_no_key" ON "payments" USING btree ("order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_channel_ref_key" ON "payments" USING btree ("channel","channel_ref");--> statement-breakpoint
CREATE INDEX "payments_actor_idx" ON "payments" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "payments_created_idx" ON "payments" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "payments_moved_idx" ON "payments" USING btree ("moved_at");