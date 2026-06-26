CREATE TABLE "work_activity_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_external_id" text NOT NULL,
	"activity_date" date NOT NULL,
	"person_id" uuid,
	"external_employee_id" text,
	"employee_no" text,
	"site_org_unit_id" uuid,
	"site_code" text,
	"site_name" text,
	"source_code" text,
	"source_label" text,
	"hours" numeric(8, 2),
	"business_km" integer,
	"personal_km" integer,
	"description" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "truck_log_truck_date_ux";--> statement-breakpoint
ALTER TABLE "truck_log_entries" ALTER COLUMN "driver_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "entry_mode" text DEFAULT 'destination' NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "business_km" integer;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "personal_km" integer;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "other_destination" text;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "source_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "source_work_activity_id" uuid;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "source_external_id" text;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "import_status" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD COLUMN "import_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_activity_entries" ADD CONSTRAINT "work_activity_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_activity_entries" ADD CONSTRAINT "work_activity_entries_source_connection_id_sync_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_activity_entries" ADD CONSTRAINT "work_activity_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_activity_entries" ADD CONSTRAINT "work_activity_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_activity_tenant_idx" ON "work_activity_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "work_activity_date_idx" ON "work_activity_entries" USING btree ("tenant_id","activity_date");--> statement-breakpoint
CREATE INDEX "work_activity_person_date_idx" ON "work_activity_entries" USING btree ("tenant_id","person_id","activity_date");--> statement-breakpoint
CREATE INDEX "work_activity_site_idx" ON "work_activity_entries" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_activity_source_ux" ON "work_activity_entries" USING btree ("tenant_id","source_connection_id","source_external_id");--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_source_connection_id_sync_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."sync_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_source_work_activity_id_work_activity_entries_id_fk" FOREIGN KEY ("source_work_activity_id") REFERENCES "public"."work_activity_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "truck_log_driver_date_idx" ON "truck_log_entries" USING btree ("tenant_id","driver_person_id","entry_date");--> statement-breakpoint
CREATE INDEX "truck_log_import_idx" ON "truck_log_entries" USING btree ("tenant_id","source_connection_id","import_status");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_log_truck_date_ux" ON "truck_log_entries" USING btree ("tenant_id","equipment_item_id","driver_person_id","entry_date");