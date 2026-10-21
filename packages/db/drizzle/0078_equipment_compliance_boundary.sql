-- Preserve equipment delivery settings while separating them from people compliance.
ALTER TABLE tenant_notification_policy ADD COLUMN IF NOT EXISTS equipment_reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tenant_notification_policy ADD COLUMN IF NOT EXISTS equipment_reminder_cron text NOT NULL DEFAULT '0 6 * * *';
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE tenant_notification_policy SET equipment_reminders_enabled = scan_enabled,
      equipment_reminder_cron = scan_cron WHERE tenant_id = t.id;
    -- Native equipment schedules are authoritative. Never silently discard an
    -- unexpected policy introduced after the reviewed production preflight.
    IF EXISTS (SELECT 1 FROM compliance_obligations WHERE tenant_id = t.id AND source_module::text = 'equipment_inspection') THEN
      RAISE EXCEPTION 'Equipment compliance obligations require review before cutover for tenant %', t.id;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DROP VIEW IF EXISTS report_skill_coverage;
DROP VIEW IF EXISTS report_training_matrix;
ALTER TYPE public.compliance_source_module RENAME TO compliance_source_module_retired;
CREATE TYPE public.compliance_source_module AS ENUM (
  'inspection', 'document', 'training', 'form', 'journal',
  'cert_requirement', 'skill_requirement', 'ppe_inspection',
  'job_title_signoff', 'corrective_action', 'hazard_assessment'
);
ALTER TABLE compliance_obligations ALTER COLUMN source_module TYPE public.compliance_source_module
  USING source_module::text::public.compliance_source_module;
DROP TYPE public.compliance_source_module_retired;
