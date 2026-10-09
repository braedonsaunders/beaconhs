-- Rebuild rather than ADD VALUE: pending Drizzle migrations share a transaction.
-- Views are reinstated by the migration runner with their current definitions.
DROP VIEW IF EXISTS report_skill_coverage;
DROP VIEW IF EXISTS report_training_matrix;
--> statement-breakpoint
ALTER TYPE public.compliance_source_module RENAME TO compliance_source_module_retired;
CREATE TYPE public.compliance_source_module AS ENUM (
  'inspection', 'document', 'training', 'form', 'journal',
  'cert_requirement', 'skill_requirement', 'equipment_inspection', 'ppe_inspection',
  'job_title_signoff', 'corrective_action', 'hazard_assessment'
);
ALTER TABLE compliance_obligations
  ALTER COLUMN source_module TYPE public.compliance_source_module
  USING (CASE WHEN source_module::text = 'cert_requirement' AND target_ref ? 'skillTypeId'
    THEN 'skill_requirement' ELSE source_module::text END)::public.compliance_source_module;
DROP TYPE public.compliance_source_module_retired;
--> statement-breakpoint
-- Every skill/certificate requirement is maintained against live credential
-- expiry; preserve the obligation IDs, audiences, waiver and dispatch history.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE compliance_obligations SET recurrence_kind = 'expiry',
      recurrence = jsonb_build_object('kind', 'expiry', 'remindBeforeDays',
        COALESCE(recurrence->'remindBeforeDays', '30'::jsonb))
    WHERE tenant_id = t.id AND source_module IN ('cert_requirement', 'skill_requirement');
  END LOOP;
END $$;
--> statement-breakpoint
-- Re-acknowledging an unchanged version in a later cadence retains the original
-- signature. Same-period duplicate writes are serialized on the document row.
DROP INDEX IF EXISTS document_acks_tenant_doc_version_person_ux;
CREATE INDEX IF NOT EXISTS document_acks_tenant_doc_version_person_idx
  ON document_acknowledgments (tenant_id, document_id, version_id, person_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_acks_tenant_session_person_ux
  ON document_acknowledgments (tenant_id, session_id, person_id);
