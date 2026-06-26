CREATE TYPE "public"."notification_group_member_kind" AS ENUM('everyone', 'person', 'role', 'department', 'org_unit', 'trade', 'crew', 'person_group');--> statement-breakpoint
CREATE TYPE "public"."notification_group_member_mode" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."equipment_scan_mode" AS ENUM('toggle', 'explicit');--> statement-breakpoint
ALTER TYPE "public"."training_delivery_type" ADD VALUE 'online';--> statement-breakpoint
CREATE TABLE "notification_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "notification_group_member_kind" NOT NULL,
	"entity_key" text DEFAULT '' NOT NULL,
	"mode" "notification_group_member_mode" DEFAULT 'include' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "equipment_station_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_check_in_org_unit_id" uuid,
	"station_pin" text,
	"scan_mode" "equipment_scan_mode" DEFAULT 'toggle' NOT NULL,
	"require_holder_on_checkout" boolean DEFAULT false NOT NULL,
	"require_condition_on_checkin" boolean DEFAULT false NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_records" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_records" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ALTER COLUMN "skill_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "is_equipment_base" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "online_url" text;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "training_skill_assignments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" ADD COLUMN "group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "database" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_group_id_notification_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."notification_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_groups" ADD CONSTRAINT "notification_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_station_settings" ADD CONSTRAINT "equipment_station_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_station_settings" ADD CONSTRAINT "equipment_station_settings_default_check_in_org_unit_id_org_units_id_fk" FOREIGN KEY ("default_check_in_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_group_members_tenant_idx" ON "notification_group_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notification_group_members_group_idx" ON "notification_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_group_members_unique_ux" ON "notification_group_members" USING btree ("group_id","kind","entity_key","mode");--> statement-breakpoint
CREATE INDEX "notification_groups_tenant_idx" ON "notification_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_groups_tenant_name_ux" ON "notification_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_station_settings_uniq" ON "equipment_station_settings" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_category_id_equipment_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."equipment_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_items_category_idx" ON "equipment_items" USING btree ("tenant_id","category_id");