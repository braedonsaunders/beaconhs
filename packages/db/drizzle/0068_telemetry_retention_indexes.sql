CREATE INDEX IF NOT EXISTS "equipment_telemetry_observations_retention_idx" ON "equipment_telemetry_observations" ("observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_runs_retention_idx" ON "sync_runs" ("started_at") WHERE "status" IN ('success', 'partial', 'error') AND "completed_at" IS NOT NULL;
