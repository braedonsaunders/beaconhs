DROP INDEX "truck_log_truck_date_ux";--> statement-breakpoint
ALTER TABLE "truck_log_entries" ALTER COLUMN "driver_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "entry_mode" text DEFAULT 'destination' NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "business_km" integer;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "personal_km" integer;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "other_destination" text;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "source_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "source_external_id" text;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "import_status" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "import_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_source_connection_id_sync_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "truck_log_driver_date_idx" ON "truck_log_entries" USING btree ("tenant_id","driver_person_id","entry_date");--> statement-breakpoint
CREATE INDEX "truck_log_import_idx" ON "truck_log_entries" USING btree ("tenant_id","source_connection_id","import_status");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_log_truck_date_ux" ON "truck_log_entries" USING btree ("tenant_id","equipment_item_id","driver_person_id","entry_date");
