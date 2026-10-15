// Input rules and op keys shared by the hazard-assessment record page (client),
// its Server Actions, and its record saver. Pure: no database or server-only
// imports, so the row editors can build the same op keys the saver resolves.

import { parseRowFieldId, rowFieldId } from '@/lib/offline-drafts/field-ids'

/** Optional text input: trimmed; blank clears the column. */
export function nullableText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** A checkbox / switch value as posted by forms ('on') or the live editors ('true'). */
export function postedFlag(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true'
}

/** A live editor's wire value as text ('' for empty); anything else is refused. */
export function wireText(wire: unknown): string {
  if (wire == null) return ''
  if (typeof wire === 'string') return wire
  throw new Error('This value is invalid.')
}

export const PPE_ANSWERS = ['yes', 'no', 'na'] as const
export type PpeAnswer = (typeof PPE_ANSWERS)[number]

/** The answers a Yes / No question offers. */
export const YES_NO_ANSWERS = ['Yes', 'No', 'N/A'] as const

type AssessmentQuestionType = 'yes_no' | 'text' | 'multi_select'

/**
 * A question's answer: trimmed, blank clears it. Yes / No questions take one
 * of their three answers and choice questions one of their listed options;
 * free-text questions take any text.
 */
export function parseQuestionAnswer(
  question: { questionType: AssessmentQuestionType; answers: string[] },
  wire: unknown,
): string | null {
  if (wire != null && typeof wire !== 'string') throw new Error('Answer is invalid.')
  const answer = nullableText(wire)
  if (answer === null) return null
  const allowed =
    question.questionType === 'yes_no'
      ? (YES_NO_ANSWERS as readonly string[])
      : question.questionType === 'multi_select'
        ? question.answers
        : null
  if (allowed && !allowed.includes(answer)) throw new Error('Answer is invalid.')
  return answer
}

// ---------------------------------------------------------------------------
// Child-row op keys: `<rows>:<rowId>:<field>`, e.g. `ppe:<uuid>:answer`.
// ---------------------------------------------------------------------------

export type AssessmentRowOp =
  | { kind: 'hazards'; rowId: string; field: 'applicable' | 'specificControls' }
  | { kind: 'ppe'; rowId: string; field: 'answer' }
  | { kind: 'questions'; rowId: string; field: 'answer' }

const ROW_FIELDS = {
  hazards: ['applicable', 'specificControls'],
  ppe: ['answer'],
  questions: ['answer'],
} as const

export function assessmentRowOpKey(op: AssessmentRowOp): string {
  return rowFieldId(op.kind, op.rowId, op.field)
}

/** The child-row op an op key names, or null for any other key. */
export function parseAssessmentRowOp(key: string): AssessmentRowOp | null {
  const parsed = parseRowFieldId<AssessmentRowOp['kind'], AssessmentRowOp['field']>(key, ROW_FIELDS)
  return parsed
    ? ({ kind: parsed.collection, rowId: parsed.rowId, field: parsed.field } as AssessmentRowOp)
    : null
}
