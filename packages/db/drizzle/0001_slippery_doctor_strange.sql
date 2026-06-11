CREATE TABLE "training_skill_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_assignment_id" uuid NOT NULL,
	"pdf_attachment_id" uuid,
	"verify_token" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_skill_certificates" ADD CONSTRAINT "training_skill_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_certificates" ADD CONSTRAINT "training_skill_certificates_skill_assignment_id_training_skill_assignments_id_fk" FOREIGN KEY ("skill_assignment_id") REFERENCES "public"."training_skill_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_skill_certificates_assignment_idx" ON "training_skill_certificates" USING btree ("skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_certificates_token_idx" ON "training_skill_certificates" USING btree ("verify_token");