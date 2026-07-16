CREATE TABLE "training_record_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_record_files_kind_ck" CHECK ("training_record_files"."kind" IN ('certificate', 'evidence', 'photo', 'other'))
);
--> statement-breakpoint
ALTER TABLE "training_record_files" ADD CONSTRAINT "training_record_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record_files" ADD CONSTRAINT "training_record_files_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record_files" ADD CONSTRAINT "training_record_files_tenant_record_fk" FOREIGN KEY ("tenant_id","record_id") REFERENCES "public"."training_records"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record_files" ADD CONSTRAINT "training_record_files_tenant_attachment_fk" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."attachments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_record_files_tenant_idx" ON "training_record_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "training_record_files_record_idx" ON "training_record_files" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "training_record_files_kind_idx" ON "training_record_files" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "training_record_files_attachment_ux" ON "training_record_files" USING btree ("tenant_id","record_id","attachment_id");
