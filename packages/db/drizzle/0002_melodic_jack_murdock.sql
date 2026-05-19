CREATE TYPE "public"."inspection_bank_response_type" AS ENUM('pass_fail_na', 'rating', 'yes_no');--> statement-breakpoint
CREATE TYPE "public"."atmospheric_sensor_status" AS ENUM('active', 'out_of_service', 'retired');--> statement-breakpoint
CREATE TYPE "public"."atmospheric_sensor_type" AS ENUM('multi_gas', '4_gas', 'single_gas');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_bank_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"response_type" "inspection_bank_response_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "atmospheric_calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sensor_id" uuid NOT NULL,
	"calibrated_on" date NOT NULL,
	"calibrated_by_tenant_user_id" uuid,
	"notes" text,
	"certificate_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "atmospheric_sensors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identifier" text NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"type" "atmospheric_sensor_type" NOT NULL,
	"gases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_calibration_on" date,
	"next_calibration_due" date,
	"status" "atmospheric_sensor_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_skill_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"skill_type_id" uuid NOT NULL,
	"granted_on" date NOT NULL,
	"expires_on" date,
	"granted_by_tenant_user_id" uuid,
	"evidence_attachment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_skill_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"jurisdiction" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_skill_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"valid_for_months" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_bank_criteria" ADD CONSTRAINT "inspection_bank_criteria_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_bank_criteria" ADD CONSTRAINT "inspection_bank_criteria_bank_id_inspection_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."inspection_banks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_banks" ADD CONSTRAINT "inspection_banks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_banks" ADD CONSTRAINT "inspection_banks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "atmospheric_calibrations" ADD CONSTRAINT "atmospheric_calibrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "atmospheric_calibrations" ADD CONSTRAINT "atmospheric_calibrations_sensor_id_atmospheric_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."atmospheric_sensors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "atmospheric_calibrations" ADD CONSTRAINT "atmospheric_calibrations_calibrated_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("calibrated_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "atmospheric_calibrations" ADD CONSTRAINT "atmospheric_calibrations_certificate_attachment_id_attachments_id_fk" FOREIGN KEY ("certificate_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "atmospheric_sensors" ADD CONSTRAINT "atmospheric_sensors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_skill_type_id_training_skill_types_id_fk" FOREIGN KEY ("skill_type_id") REFERENCES "public"."training_skill_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_granted_by_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("granted_by_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_assignments" ADD CONSTRAINT "training_skill_assignments_evidence_attachment_id_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_authorities" ADD CONSTRAINT "training_skill_authorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_types" ADD CONSTRAINT "training_skill_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_skill_types" ADD CONSTRAINT "training_skill_types_authority_id_training_skill_authorities_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."training_skill_authorities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_bank_criteria_bank_seq_idx" ON "inspection_bank_criteria" USING btree ("bank_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_bank_criteria_tenant_idx" ON "inspection_bank_criteria" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_banks_tenant_idx" ON "inspection_banks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_banks_tenant_category_idx" ON "inspection_banks" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "atmospheric_calibrations_tenant_idx" ON "atmospheric_calibrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "atmospheric_calibrations_sensor_date_idx" ON "atmospheric_calibrations" USING btree ("sensor_id","calibrated_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "atmospheric_sensors_tenant_idx" ON "atmospheric_sensors" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "atmospheric_sensors_tenant_identifier_ux" ON "atmospheric_sensors" USING btree ("tenant_id","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "atmospheric_sensors_next_due_idx" ON "atmospheric_sensors" USING btree ("tenant_id","next_calibration_due");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignments_tenant_idx" ON "training_skill_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignments_person_idx" ON "training_skill_assignments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignments_skill_type_idx" ON "training_skill_assignments" USING btree ("skill_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_assignments_expires_idx" ON "training_skill_assignments" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_authorities_tenant_idx" ON "training_skill_authorities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_authorities_tenant_code_idx" ON "training_skill_authorities" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_types_tenant_idx" ON "training_skill_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_skill_types_authority_idx" ON "training_skill_types" USING btree ("authority_id");