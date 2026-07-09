-- The signed-report bundle feature's UI was removed before public release and
-- the worker render path was deleted in the PDF-template cutover, leaving this
-- table orphaned (zero code references, zero rows). Idempotent for
-- push-managed databases.
DROP TABLE IF EXISTS "hazid_signed_reports" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "hazid_signed_report_status";
