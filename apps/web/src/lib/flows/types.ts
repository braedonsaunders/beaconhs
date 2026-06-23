// The seam that makes ONE Flows executor drive every subject (Builder form
// templates + native modules). A subject implements this adapter; the generic
// executor (execute-flow-plan.ts) calls only these methods. Optional capabilities
// that a subject doesn't support are SKIPPED gracefully — a journal flow simply
// can't `start_monitored_session`, so that action is never offered to it and, if
// somehow present, is reported as unsupported rather than crashing the run.

import type { ActionData, EvalContext } from '@beaconhs/forms-core'

export type FlowActorRef = { tenantUserId: string | null; userId: string | null; email: string | null }

export type ExtraActionHelpers = {
  values: Record<string, unknown>
  fieldPatch: Record<string, unknown>
  evalCtx: EvalContext
}

export type FlowSubjectAdapter = {
  subjectType: 'form_template' | 'module'
  /** templateId (forms) | moduleKey (modules). */
  subjectKey: string | null
  /** The record id this run is about (responseId, journalId, …). */
  subjectId: string
  /** Notification + email-log category for this subject (e.g. 'forms', 'journals'). */
  notifyCategory: string
  /** audit_log.entity_type for runs against this subject ('form_response', 'journal_entry', …). */
  auditEntityType: string
  /** Deep link to the record, used in approval notifications. */
  deepLink(): string
  /** The subject's current field-map — for condition eval, {{interpolation}} + gate resume. */
  loadValues(): Promise<Record<string, unknown>>
  /** Who "submitted"/owns the record — for the `submitter` email/assignee target. */
  resolveSubmitter(): Promise<FlowActorRef>

  // --- optional capabilities (absent ⇒ action skipped) ----------------------
  spawnCorrectiveAction?(i: {
    title: string
    description?: string | null
    severity?: 'low' | 'medium' | 'high' | 'critical'
    dueOn?: string | null
  }): Promise<{ ok: boolean }>
  spawnIncident?(i: { title: string }): Promise<{ ok: boolean }>
  /** Persist set_field patches + the non-compliant flag (forms write back to the response). */
  persistAfterRun?(p: { fieldPatch: Record<string, unknown>; flagNonCompliant: boolean }): Promise<void>
  /** Subject-specific actions the generic executor doesn't know (forms-only today). */
  handleExtraAction?(
    action: ActionData,
    helpers: ExtraActionHelpers,
  ): Promise<{ ran: string[]; failed: string[] }>
}
