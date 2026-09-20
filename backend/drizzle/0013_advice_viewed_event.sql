ALTER TABLE "events" DROP CONSTRAINT "events_type_known";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_payload_matches_type";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_type_known" CHECK ("events"."type" in ('session_started', 'catalogue_viewed', 'advice_viewed'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payload_matches_type" CHECK (("events"."type" not in ('catalogue_viewed', 'advice_viewed')
             or (jsonb_exists("events"."payload", 'subject')
                 and "events"."payload" ->> 'subject' in ('product', 'venue')
                 and "events"."payload" - 'subject' = '{}'::jsonb))
          and ("events"."type" <> 'session_started'
             or "events"."payload" = '{}'::jsonb));