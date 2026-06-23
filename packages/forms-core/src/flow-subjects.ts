// Flow SUBJECTS — the small abstraction that lets ONE Flows engine + ONE canvas
// drive both Builder form templates and native modules (journals, hazard
// assessments, incidents, …).
//
// A `FlowSubjectProfile` is pure data describing what a subject offers: which
// triggers/actions are valid, which status values exist, and the field "tokens"
// available for conditions, {{interpolation}}, and recipient resolution. The
// canvas renders against this profile; `lintAutomationGraph(graph, fieldIds,
// profile)` rejects anything outside it. Server-side behaviour lives in the
// matching FlowSubjectAdapter (apps/web/src/lib/flows).

import type { TriggerData, ActionData } from './automation'

export type FlowSubjectType = 'form_template' | 'module'

export type FlowFieldKind = 'text' | 'number' | 'enum' | 'date' | 'person' | 'org_unit' | 'bool'

/** A merge token / condition field exposed by a subject. */
export type FlowFieldDef = {
  key: string
  label: string
  kind?: FlowFieldKind
}

export type FlowSubjectProfile = {
  subjectType: FlowSubjectType
  /** templateId (forms) | moduleKey e.g. 'journals' (modules). */
  subjectKey: string
  /** Human label used in lint messages + canvas chrome. */
  label: string
  triggers: TriggerData['trigger'][]
  actions: ActionData['action'][]
  /** Allowed `to` values for a status_change trigger (modules with a status enum). */
  statusValues?: string[]
  /** Field tokens for conditions, {{interpolation}}, and recipient `field` targets. */
  fields: FlowFieldDef[]
  /**
   * True when this subject has a rich, full-record PDF renderer (incidents,
   * hazard assessments, corrective actions, form responses). When true, the
   * send_email PDF picker offers "Full record PDF" vs "Field summary"; when
   * false, only the generic field-summary PDF is available.
   */
  richPdf?: boolean
}

// The full vocabulary a Builder form template supports today — used to build the
// form-template profile so the existing designer keeps every trigger/action.
export const FORM_TEMPLATE_TRIGGERS: TriggerData['trigger'][] = [
  'on_submit',
  'on_field_value',
  'status_change',
  'scheduled',
  'session_overdue',
]

export const FORM_TEMPLATE_ACTIONS: ActionData['action'][] = [
  'send_email',
  'create_capa',
  'create_incident',
  'notify_role',
  'set_field',
  'flag_non_compliant',
  'webhook',
  'create_response',
  'analyze_photos',
  'start_monitored_session',
]

export const FORM_STATUS_VALUES: string[] = [
  'submitted',
  'in_review',
  'closed',
  'rejected',
  'non_compliant',
]
