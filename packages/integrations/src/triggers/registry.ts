// The trigger catalog: every domain event an automation can fire on, plus the
// token fields its payload exposes. `fields` powers the builder's reference
// panel + sample-send; the matching payload is produced by the emit helpers in
// ./emit.ts (one place builds each event from entity data already in scope).

import type { FieldDef, TriggerDef } from '../types'

const f = (
  key: string,
  label: string,
  type: FieldDef['type'],
  sample?: FieldDef['sample'],
  note?: string,
): FieldDef => ({ key, label, type, sample, note })

const COMMON_URL = f('url', 'Link to record', 'string', 'https://app.example.com/incidents/123')

export const TRIGGERS: TriggerDef[] = [
  {
    key: 'training.class.completed',
    label: 'Training class completed',
    description: 'A class was marked complete — one item per attended person.',
    module: 'training',
    iconKey: 'graduation-cap',
    subjectLabel: 'training class',
    itemScope: 'collection',
    fields: [
      f('classId', 'Class id', 'string'),
      f('course.code', 'Course code', 'string', 'WHMIS'),
      f('course.name', 'Course name', 'string', 'WHMIS 2015'),
      f('startsAt', 'Starts at', 'date', '2026-06-01'),
      f('endsAt', 'Ends at', 'date', '2026-06-01'),
      f('hoursPerDay', 'Hours per day', 'number', 8),
      f('lengthDays', 'Length (days)', 'number', 1),
      f('personId', 'Person id', 'string'),
      f('externalEmployeeId', 'External employee id', 'string', 'E-1042'),
      f('firstName', 'First name', 'string', 'Sam'),
      f('lastName', 'Last name', 'string', 'Rivera'),
      f('fullName', 'Full name', 'string', 'Sam Rivera'),
      f('departmentName', 'Department', 'string', 'Field Ops'),
      f('hours', 'Credited hours', 'number', 8),
      f('attended', 'Attended', 'boolean', true),
    ],
  },
  {
    key: 'incident.created',
    label: 'Incident reported',
    description: 'A new incident was reported.',
    module: 'incidents',
    iconKey: 'alert-triangle',
    subjectLabel: 'incident',
    itemScope: 'single',
    fields: [
      f('incidentId', 'Incident id', 'string'),
      f('reference', 'Reference', 'string', 'INC-2026-0001'),
      f('type', 'Type', 'string', 'injury'),
      f('severity', 'Severity', 'string', 'high'),
      f('status', 'Status', 'string', 'reported'),
      f('title', 'Title', 'string', 'Slip on wet floor'),
      f('description', 'Description', 'string'),
      f('occurredAt', 'Occurred at', 'date', '2026-06-20'),
      f('location', 'Location', 'string', 'Bay 3'),
      f('reportedByName', 'Reported by', 'string', 'Alex Chen'),
      f('createdAt', 'Created at', 'date'),
      COMMON_URL,
    ],
  },
  {
    key: 'incident.status_changed',
    label: 'Incident status changed',
    description: 'An incident moved to a new status.',
    module: 'incidents',
    iconKey: 'alert-triangle',
    subjectLabel: 'incident',
    itemScope: 'single',
    fields: [
      f('incidentId', 'Incident id', 'string'),
      f('reference', 'Reference', 'string', 'INC-2026-0001'),
      f('title', 'Title', 'string'),
      f('type', 'Type', 'string'),
      f('severity', 'Severity', 'string'),
      f('fromStatus', 'From status', 'string', 'reported'),
      f('toStatus', 'To status', 'string', 'closed'),
      f('changedAt', 'Changed at', 'date'),
      COMMON_URL,
    ],
  },
  {
    key: 'corrective_action.created',
    label: 'Corrective action created',
    description: 'A corrective action was assigned.',
    module: 'corrective-actions',
    iconKey: 'clipboard-check',
    subjectLabel: 'corrective action',
    itemScope: 'single',
    fields: [
      f('caId', 'Action id', 'string'),
      f('reference', 'Reference', 'string', 'CA-2026-0001'),
      f('title', 'Title', 'string'),
      f('status', 'Status', 'string', 'open'),
      f('severity', 'Severity', 'string'),
      f('source', 'Source', 'string'),
      f('dueOn', 'Due on', 'date'),
      f('assignedOn', 'Assigned on', 'date'),
      f('ownerName', 'Owner', 'string'),
      f('assignedByName', 'Assigned by', 'string'),
      COMMON_URL,
    ],
  },
  {
    key: 'corrective_action.closed',
    label: 'Corrective action closed',
    description: 'A corrective action was completed/closed.',
    module: 'corrective-actions',
    iconKey: 'clipboard-check',
    subjectLabel: 'corrective action',
    itemScope: 'single',
    fields: [
      f('caId', 'Action id', 'string'),
      f('reference', 'Reference', 'string', 'CA-2026-0001'),
      f('title', 'Title', 'string'),
      f('status', 'Status', 'string', 'closed'),
      f('severity', 'Severity', 'string'),
      f('closedAt', 'Closed at', 'date'),
      f('ownerName', 'Owner', 'string'),
      COMMON_URL,
    ],
  },
  {
    key: 'form.submitted',
    label: 'Form submitted',
    description: 'A form/app response was submitted.',
    module: 'forms',
    iconKey: 'file-text',
    subjectLabel: 'form submission',
    itemScope: 'single',
    fields: [
      f('responseId', 'Response id', 'string'),
      f('templateId', 'Template id', 'string'),
      f('templateName', 'Form name', 'string'),
      f('status', 'Status', 'string', 'submitted'),
      f('submittedByName', 'Submitted by', 'string'),
      f('submittedAt', 'Submitted at', 'date'),
      f('complianceScore', 'Compliance score', 'number'),
      f('complianceStatus', 'Compliance status', 'string'),
      COMMON_URL,
    ],
    dynamicFieldsNote: 'Plus {{data.<fieldKey>}} for every field on the form.',
  },
  {
    key: 'hazard_assessment.created',
    label: 'Hazard assessment created',
    description: 'A hazard assessment (JHSA/HazID) was started.',
    module: 'hazard-assessments',
    iconKey: 'shield-alert',
    subjectLabel: 'hazard assessment',
    itemScope: 'single',
    fields: [
      f('assessmentId', 'Assessment id', 'string'),
      f('reference', 'Reference', 'string', 'HA-2026-0001'),
      f('status', 'Status', 'string', 'in_progress'),
      f('typeName', 'Assessment type', 'string'),
      f('occurredAt', 'Occurred at', 'date'),
      f('locationOnSite', 'Location on site', 'string'),
      f('supervisorName', 'Supervisor', 'string'),
      f('reportedByName', 'Reported by', 'string'),
      COMMON_URL,
    ],
  },
  {
    key: 'journal_entry.submitted',
    label: 'Journal entry submitted',
    description: 'A daily-log journal entry was submitted.',
    module: 'journals',
    iconKey: 'notebook',
    subjectLabel: 'journal entry',
    itemScope: 'single',
    fields: [
      f('entryId', 'Entry id', 'string'),
      f('reference', 'Reference', 'string'),
      f('title', 'Title', 'string'),
      f('status', 'Status', 'string', 'submitted'),
      f('submittedAt', 'Submitted at', 'date'),
      f('entryDate', 'Entry date', 'date'),
      f('authorName', 'Author', 'string'),
      f('siteName', 'Site', 'string'),
      f('summary', 'Summary', 'string'),
      COMMON_URL,
    ],
  },
]

export function listTriggers(): TriggerDef[] {
  return TRIGGERS
}

export function getTrigger(key: string | null | undefined): TriggerDef | undefined {
  if (!key) return undefined
  return TRIGGERS.find((t) => t.key === key)
}

// A representative single item built from each field's `sample` — used by the
// builder to preview a mapping and to power "send a test".
export function sampleItem(trigger: TriggerDef): Record<string, unknown> {
  const item: Record<string, unknown> = {}
  for (const fd of trigger.fields) item[fd.key] = fd.sample ?? (fd.type === 'number' ? 0 : '')
  return item
}
