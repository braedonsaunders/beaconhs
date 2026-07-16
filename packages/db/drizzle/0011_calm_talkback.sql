ALTER TABLE "report_schedules" ADD COLUMN "repeat_every" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "week_of_month" integer;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "email_subject" text;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "email_message" text;--> statement-breakpoint
UPDATE "report_schedules"
SET "next_run_at" = date_trunc('minute', now())
WHERE "active" = true AND "next_run_at" IS NULL;
