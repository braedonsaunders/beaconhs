ALTER TABLE "training_enrollments" ADD COLUMN "completion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN "completion_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN "completion_reviewed_by_tenant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN "completion_review_note" text;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_tenant_completion_reviewer_fk" FOREIGN KEY ("tenant_id","completion_reviewed_by_tenant_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_enrollments_completion_review_idx" ON "training_enrollments" USING btree ("tenant_id","course_id","completion_requested_at","completion_reviewed_at");--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_completion_review_ck" CHECK ((
        "training_enrollments"."completion_reviewed_at" IS NULL
        AND "training_enrollments"."completion_reviewed_by_tenant_user_id" IS NULL
      ) OR (
        "training_enrollments"."completion_requested_at" IS NOT NULL
        AND "training_enrollments"."completion_reviewed_at" IS NOT NULL
        AND "training_enrollments"."completion_reviewed_by_tenant_user_id" IS NOT NULL
      ));