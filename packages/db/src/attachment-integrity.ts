export type AttachmentTenantReference = {
  table: string
  column: string
  onDelete: 'cascade' | 'set null'
}

/**
 * Every attachment-id column in the tenant schema. The cutover migration uses
 * this manifest to install the sole database relationship for each column: a
 * composite tenant FK that prevents tenant B from linking tenant A's object.
 * Drizzle must not also emit a redundant single-column attachments.id FK.
 */
export const ATTACHMENT_TENANT_REFERENCES = [
  { table: 'attachment_upload_reservations', column: 'attachment_id', onDelete: 'set null' },
  { table: 'ca_complete_steps', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'ca_photos', column: 'attachment_id', onDelete: 'cascade' },
  { table: 'document_acknowledgments', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'document_references', column: 'attachment_id', onDelete: 'set null' },
  { table: 'document_versions', column: 'content_attachment_id', onDelete: 'set null' },
  { table: 'document_versions', column: 'docx_attachment_id', onDelete: 'set null' },
  { table: 'document_versions', column: 'pdf_attachment_id', onDelete: 'set null' },
  { table: 'documents', column: 'source_attachment_id', onDelete: 'set null' },
  {
    table: 'equipment_inspection_record_attachments',
    column: 'attachment_id',
    onDelete: 'cascade',
  },
  { table: 'equipment_items', column: 'manual_attachment_id', onDelete: 'set null' },
  { table: 'equipment_items', column: 'photo_attachment_id', onDelete: 'set null' },
  { table: 'equipment_log_entries', column: 'attachment_id', onDelete: 'set null' },
  { table: 'flow_gates', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'form_response_steps', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'form_responses', column: 'pdf_attachment_id', onDelete: 'set null' },
  {
    table: 'hazid_assessment_photos',
    column: 'attachment_id',
    onDelete: 'cascade',
  },
  {
    table: 'hazid_assessment_signatures',
    column: 'signature_attachment_id',
    onDelete: 'set null',
  },
  { table: 'hazid_hazards', column: 'photo_attachment_id', onDelete: 'set null' },
  { table: 'incident_attachments', column: 'attachment_id', onDelete: 'cascade' },
  {
    table: 'inspection_record_attachments',
    column: 'attachment_id',
    onDelete: 'cascade',
  },
  {
    table: 'inspection_records',
    column: 'customer_signature_attachment_id',
    onDelete: 'set null',
  },
  {
    table: 'job_title_task_acknowledgments',
    column: 'signature_attachment_id',
    onDelete: 'set null',
  },
  { table: 'journal_entry_photos', column: 'attachment_id', onDelete: 'cascade' },
  { table: 'people', column: 'photo_attachment_id', onDelete: 'set null' },
  { table: 'people', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'person_files', column: 'attachment_id', onDelete: 'set null' },
  { table: 'ppe_annual_records', column: 'certificate_attachment_id', onDelete: 'set null' },
  { table: 'ppe_issues', column: 'receipt_signature_attachment_id', onDelete: 'set null' },
  { table: 'report_runs', column: 'pdf_attachment_id', onDelete: 'set null' },
  { table: 'training_certificates', column: 'pdf_attachment_id', onDelete: 'set null' },
  { table: 'training_class_attendees', column: 'signature_attachment_id', onDelete: 'set null' },
  { table: 'training_content_items', column: 'attachment_id', onDelete: 'set null' },
  { table: 'training_content_items', column: 'source_attachment_id', onDelete: 'set null' },
  { table: 'training_course_files', column: 'attachment_id', onDelete: 'set null' },
  {
    table: 'training_lesson_progress',
    column: 'evaluation_signature_attachment_id',
    onDelete: 'set null',
  },
  { table: 'training_lessons', column: 'attachment_id', onDelete: 'set null' },
  { table: 'training_lessons', column: 'source_attachment_id', onDelete: 'set null' },
  { table: 'training_records', column: 'certificate_attachment_id', onDelete: 'set null' },
  { table: 'training_skill_assignment_files', column: 'attachment_id', onDelete: 'set null' },
  { table: 'training_skill_assignments', column: 'evidence_attachment_id', onDelete: 'set null' },
  { table: 'training_skill_certificates', column: 'pdf_attachment_id', onDelete: 'set null' },
] as const satisfies readonly AttachmentTenantReference[]

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function attachmentTenantConstraintName(reference: AttachmentTenantReference): string {
  const stem = `${reference.table}_${reference.column}`
  return `att_tenant_${stem.slice(0, 40)}_${stableHash(stem)}`
}

function sqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `"${value}"`
}

/** PostgreSQL 16 composite tenant-FK DDL used by the migration reconciler. */
export function attachmentTenantConstraintSql(reference: AttachmentTenantReference): string {
  const table = sqlIdentifier(reference.table)
  const column = sqlIdentifier(reference.column)
  const name = sqlIdentifier(attachmentTenantConstraintName(reference))
  const onDelete =
    reference.onDelete === 'cascade' ? 'ON DELETE CASCADE' : `ON DELETE SET NULL (${column})`
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${name.replaceAll('"', "'")}) THEN
    ALTER TABLE ${table}
      ADD CONSTRAINT ${name}
      FOREIGN KEY ("tenant_id", ${column})
      REFERENCES "attachments" ("tenant_id", "id")
      ${onDelete}
      NOT VALID;
  END IF;
END $$;
ALTER TABLE ${table} VALIDATE CONSTRAINT ${name};`
}
