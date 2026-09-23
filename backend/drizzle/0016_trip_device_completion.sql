ALTER TABLE "trips" ADD COLUMN "finished_on_device_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "trips_actor_finished_idx" ON "trips" USING btree ("actor_id",coalesce("finished_on_device_at", "finished_at") desc,"id" desc) WHERE "trips"."finished_at" is not null;
