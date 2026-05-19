CREATE TYPE "public"."work_order_priority" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."document_book_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "truck_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"driver_person_id" uuid,
	"start_odometer" integer,
	"end_odometer" integer,
	"km_driven" integer,
	"site_org_unit_id" uuid,
	"hours_on_site" numeric(6, 2),
	"manpower_count" integer,
	"notes" text,
	"created_by_tenant_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_books" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD COLUMN "priority" "work_order_priority" DEFAULT 'med' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD COLUMN "action_taken" text;--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD COLUMN "cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "equipment_work_orders" ADD COLUMN "reported_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "document_books" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_books" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "document_books" ADD COLUMN "status" "document_book_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_books" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_books" ADD COLUMN "published_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_driver_person_id_people_id_fk" FOREIGN KEY ("driver_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_site_org_unit_id_org_units_id_fk" FOREIGN KEY ("site_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "truck_log_entries" ADD CONSTRAINT "truck_log_entries_created_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("created_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_log_tenant_idx" ON "truck_log_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "truck_log_truck_date_ux" ON "truck_log_entries" USING btree ("tenant_id","equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_log_date_idx" ON "truck_log_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_log_truck_idx" ON "truck_log_entries" USING btree ("equipment_item_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_log_site_idx" ON "truck_log_entries" USING btree ("tenant_id","site_org_unit_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_work_orders" ADD CONSTRAINT "equipment_work_orders_reported_by_person_id_people_id_fk" FOREIGN KEY ("reported_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_books" ADD CONSTRAINT "document_books_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_work_orders_priority_idx" ON "equipment_work_orders" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_books_status_idx" ON "document_books" USING btree ("tenant_id","status");