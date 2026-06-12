// Shared metadata for the unified obligation form. Pure data — client + server
// both import it. Now covers EVERY module, not just the 5 audience kinds: the
// kind maps 1:1 to `compliance_obligations.sourceModule`, and each kind declares
// its subject shape (per_person / per_record / per_task), whether it has an
// audience, its target picker, and its schedule knobs.

import type { AudienceType } from '@/components/audience-picker'
import type { RecurrenceFields } from '@/components/recurrence'

export const OBLIGATION_KINDS = [
  'inspection',
  'document',
  'training',
  'cert_requirement',
  'form',
  'journal',
  'equipment_inspection',
  'ppe_inspection',
  'job_title_signoff',
] as const
export type ObligationKind = (typeof OBLIGATION_KINDS)[number]

export type SubjectKind = 'per_person' | 'per_record' | 'per_task'

export type TargetKind =
  | 'inspectionType'
  | 'document'
  | 'trainingItem'
  | 'cert'
  | 'formTemplate'
  | 'journalName'
  | 'equipmentType'
  | 'ppeType'
  | 'jobTitle'

export type KindMeta = {
  label: string
  subjectKind: SubjectKind
  /** per_person kinds resolve an audience; per_record/per_task do not. */
  audience: boolean
  audienceTypes: AudienceType[]
  recurrence: RecurrenceFields
  target: TargetKind
  /** One-line helper shown under the kind selector. */
  hint: string
}

const PERSON_AUD: AudienceType[] = ['everyone', 'role', 'trade', 'department', 'person', 'org_unit']

export const KIND_META: Record<ObligationKind, KindMeta> = {
  inspection: {
    label: 'Inspection',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: ['everyone', 'role', 'person', 'org_unit'],
    recurrence: { recurring: true, quantity: true, threshold: true, dueOffset: true },
    target: 'inspectionType',
    hint: 'These people each complete an inspection of this type, on this cadence.',
  },
  document: {
    label: 'Document acknowledgement',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: ['everyone', 'role', 'trade', 'department', 'person'],
    recurrence: { oneTime: true },
    target: 'document',
    hint: 'These people must acknowledge this document.',
  },
  training: {
    label: 'Training / assessment',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: ['everyone', 'role', 'trade', 'person'],
    recurrence: { oneTime: true, recurring: true, remind: true },
    target: 'trainingItem',
    hint: 'These people must complete this course or assessment.',
  },
  cert_requirement: {
    label: 'Certification requirement',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: PERSON_AUD,
    recurrence: {},
    target: 'cert',
    hint: 'These people must hold a currently-valid certification for this course.',
  },
  form: {
    label: 'App (scheduled)',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: ['role', 'person', 'org_unit'],
    recurrence: { recurring: true, dueOffset: true },
    target: 'formTemplate',
    hint: 'These people must submit this app on this cadence.',
  },
  journal: {
    label: 'Journal',
    subjectKind: 'per_person',
    audience: true,
    audienceTypes: ['everyone', 'person', 'org_unit'],
    recurrence: { recurring: true, quantity: true, threshold: true },
    target: 'journalName',
    hint: 'These people must log journal entries on this cadence.',
  },
  equipment_inspection: {
    label: 'Equipment inspection policy',
    subjectKind: 'per_record',
    audience: false,
    audienceTypes: [],
    recurrence: {},
    target: 'equipmentType',
    hint: 'Every equipment item of this type must stay within its inspection cadence.',
  },
  ppe_inspection: {
    label: 'PPE inspection policy',
    subjectKind: 'per_record',
    audience: false,
    audienceTypes: [],
    recurrence: {},
    target: 'ppeType',
    hint: 'Every PPE item of this type must stay within its inspection / expiry cadence.',
  },
  job_title_signoff: {
    label: 'Job-title sign-off',
    subjectKind: 'per_task',
    audience: false,
    audienceTypes: [],
    recurrence: {},
    target: 'jobTitle',
    hint: 'Everyone holding this job title must sign off the title’s tasks.',
  },
}

export function kindLabel(kind: string): string {
  return (KIND_META as Record<string, KindMeta>)[kind]?.label ?? kind
}

/** ObligationKind → compliance recurrence.kind for the stored row. */
export function recurrenceKindFor(kind: ObligationKind, oneTime: boolean): string {
  const m = KIND_META[kind]
  if (m.subjectKind === 'per_record') return 'expiry'
  if (kind === 'cert_requirement') return 'expiry'
  if (kind === 'job_title_signoff') return 'one_time'
  if (kind === 'form') return 'cron'
  if (oneTime) return 'one_time'
  return 'frequency'
}
