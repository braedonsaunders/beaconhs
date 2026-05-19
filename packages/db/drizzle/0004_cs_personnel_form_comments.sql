CREATE TYPE "public"."cs_permit_personnel_role" AS ENUM('entrant', 'attendant', 'supervisor', 'rescue');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_response_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"author_tenant_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cs_permit_personnel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"permit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "cs_permit_personnel_role" NOT NULL,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_response_comments" ADD CONSTRAINT "form_response_comments_author_tenant_user_id_tenant_users_id_fk" FOREIGN KEY ("author_tenant_user_id") REFERENCES "public"."tenant_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_permit_personnel" ADD CONSTRAINT "cs_permit_personnel_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_permit_personnel" ADD CONSTRAINT "cs_permit_personnel_permit_id_cs_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."cs_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_permit_personnel" ADD CONSTRAINT "cs_permit_personnel_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_response_comments_response_idx" ON "form_response_comments" USING btree ("response_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_response_comments_tenant_idx" ON "form_response_comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_permit_personnel_permit_idx" ON "cs_permit_personnel" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_permit_personnel_person_idx" ON "cs_permit_personnel" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_permit_personnel_tenant_idx" ON "cs_permit_personnel" USING btree ("tenant_id");