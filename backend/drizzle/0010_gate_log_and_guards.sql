CREATE INDEX "trips_place_idx" ON "trips" USING btree ("place_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_type_known" CHECK ("events"."type" in ('session_started', 'catalogue_viewed'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payload_is_object" CHECK (jsonb_typeof("events"."payload") = 'object');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payload_matches_type" CHECK (("events"."type" <> 'catalogue_viewed'
             or (jsonb_exists("events"."payload", 'subject')
                 and "events"."payload" ->> 'subject' in ('product', 'venue')))
          and ("events"."type" <> 'session_started'
             or "events"."payload" = '{}'::jsonb));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_search_key_present" CHECK (btrim("items"."search_key") <> '');--> statement-breakpoint
ALTER TABLE "search_picks" ADD CONSTRAINT "search_picks_query_key_indexable" CHECK (octet_length("search_picks"."query_key") <= 600);