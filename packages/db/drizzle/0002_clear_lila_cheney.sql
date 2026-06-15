CREATE TABLE "training_skill_assignment_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_assignment_id" uuid NOT NULL,
	"attachment_id" uuid,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_skill_assignment_id_training_skill_assignments_id_fk" FOREIGN KEY ("skill_assignment_id") REFERENCES "public"."training_skill_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_skill_assignment_files" ADD CONSTRAINT "training_skill_assignment_files_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_tenant_idx" ON "training_skill_assignment_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_assignment_idx" ON "training_skill_assignment_files" USING btree ("skill_assignment_id");--> statement-breakpoint
CREATE INDEX "training_skill_assignment_files_kind_idx" ON "training_skill_assignment_files" USING btree ("tenant_id","kind");