// FlowSubjectProfile per native module — the pure-data description that drives
// the SAME FlowsCanvas (which triggers/actions/status/fields it offers) and the
// lint. Field keys here MUST match the keys each module's adapter loadValues()
// returns, so conditions / {{interpolation}} / recipient `field` targets resolve.

import type { FlowSubjectProfile } from '@beaconhs/forms-core'

export const MODULE_FLOW_PROFILES: Record<string, FlowSubjectProfile> = {
  journals: {
    subjectType: 'module',
    subjectKey: 'journals',
    label: 'Journals',
    triggers: ['on_submit', 'on_delete'],
    actions: ['send_email', 'notify_role', 'create_capa', 'webhook'],
    statusValues: ['draft', 'submitted', 'archived'],
    fields: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'body_text', label: 'Body text', kind: 'text' },
      { key: 'entry_date', label: 'Entry date', kind: 'date' },
      { key: 'person_id', label: 'Author (person id)', kind: 'person' },
      { key: 'supervisor_person_id', label: 'Supervisor (person id)', kind: 'person' },
      { key: 'site_org_unit_id', label: 'Site', kind: 'org_unit' },
      { key: 'tags', label: 'Tags', kind: 'text' },
    ],
  },
  hazid: {
    subjectType: 'module',
    subjectKey: 'hazid',
    label: 'Hazard Assessments',
    triggers: ['on_create', 'on_sign', 'on_lock', 'on_unlock', 'on_delete'],
    actions: ['send_email', 'notify_role', 'create_capa', 'webhook'],
    fields: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'job_scope', label: 'Job scope', kind: 'text' },
      { key: 'location_on_site', label: 'Location on site', kind: 'text' },
      { key: 'locked', label: 'Locked', kind: 'bool' },
      { key: 'in_progress', label: 'In progress', kind: 'bool' },
      { key: 'occurred_at', label: 'Occurred at', kind: 'date' },
      { key: 'site_org_unit_id', label: 'Site', kind: 'org_unit' },
      { key: 'project_org_unit_id', label: 'Project', kind: 'org_unit' },
      { key: 'supervisor_person_id', label: 'Supervisor (person id)', kind: 'person' },
      { key: 'assessment_type_id', label: 'Assessment type', kind: 'text' },
    ],
  },
  incidents: {
    subjectType: 'module',
    subjectKey: 'incidents',
    label: 'Incidents',
    triggers: ['on_create', 'status_change', 'on_lock', 'on_unlock'],
    actions: ['send_email', 'notify_role', 'create_capa', 'webhook'],
    statusValues: ['reported', 'under_investigation', 'pending_review', 'closed', 'reopened'],
    fields: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'enum' },
      { key: 'severity', label: 'Severity', kind: 'enum' },
      { key: 'occurred_at', label: 'Occurred at', kind: 'date' },
      { key: 'site_org_unit_id', label: 'Site', kind: 'org_unit' },
      { key: 'department_id', label: 'Department', kind: 'text' },
      { key: 'supervisor_person_id', label: 'Supervisor (person id)', kind: 'person' },
    ],
  },
  'corrective-actions': {
    subjectType: 'module',
    subjectKey: 'corrective-actions',
    label: 'Corrective Actions',
    triggers: ['on_create', 'status_change'],
    actions: ['send_email', 'notify_role', 'webhook'],
    statusValues: ['open', 'in_progress', 'pending_verification', 'closed', 'cancelled'],
    fields: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'severity', label: 'Severity', kind: 'enum' },
      { key: 'due_on', label: 'Due on', kind: 'date' },
      { key: 'site_org_unit_id', label: 'Site', kind: 'org_unit' },
      { key: 'owner_tenant_user_id', label: 'Owner (user id)', kind: 'person' },
    ],
  },
  inspections: {
    subjectType: 'module',
    subjectKey: 'inspections',
    label: 'Inspections',
    triggers: ['on_create', 'on_submit', 'status_change'],
    actions: ['send_email', 'notify_role', 'create_capa', 'webhook'],
    statusValues: ['draft', 'in_progress', 'submitted', 'closed'],
    fields: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'type_id', label: 'Inspection type', kind: 'text' },
      { key: 'occurred_at', label: 'Occurred at', kind: 'date' },
      { key: 'site_org_unit_id', label: 'Site', kind: 'org_unit' },
      { key: 'inspector_tenant_user_id', label: 'Inspector (user id)', kind: 'person' },
    ],
  },
  training: {
    subjectType: 'module',
    subjectKey: 'training',
    label: 'Training',
    triggers: ['on_submit'],
    actions: ['send_email', 'notify_role', 'webhook'],
    statusValues: ['in_progress', 'submitted', 'cancelled'],
    fields: [
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'score', label: 'Score', kind: 'number' },
      { key: 'passed', label: 'Passed', kind: 'bool' },
      { key: 'type_id', label: 'Assessment type', kind: 'text' },
      { key: 'person_id', label: 'Person', kind: 'person' },
      { key: 'completed_at', label: 'Completed at', kind: 'date' },
    ],
  },
  equipment: {
    subjectType: 'module',
    subjectKey: 'equipment',
    label: 'Equipment',
    triggers: ['on_create', 'status_change'],
    actions: ['send_email', 'notify_role', 'webhook'],
    statusValues: ['open', 'assigned', 'in_progress', 'awaiting_parts', 'closed', 'cancelled'],
    fields: [
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'summary', label: 'Summary', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'enum' },
      { key: 'opened_at', label: 'Opened at', kind: 'date' },
      { key: 'closed_at', label: 'Closed at', kind: 'date' },
      { key: 'assigned_to_tenant_user_id', label: 'Assigned to (user id)', kind: 'person' },
    ],
  },
  documents: {
    subjectType: 'module',
    subjectKey: 'documents',
    label: 'Documents',
    triggers: ['on_create'],
    actions: ['send_email', 'notify_role', 'webhook'],
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'period_start', label: 'Period start', kind: 'date' },
      { key: 'period_end', label: 'Period end', kind: 'date' },
      { key: 'next_review_on', label: 'Next review on', kind: 'date' },
    ],
  },
}

export function moduleFlowProfile(moduleKey: string): FlowSubjectProfile | null {
  return MODULE_FLOW_PROFILES[moduleKey] ?? null
}
