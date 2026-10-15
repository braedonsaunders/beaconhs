// Server-side grading for assessment attempts.
// Pure function: given a question (kind + correctAnswer) and the user's answer,
// decide correct/incorrect/null. `text` questions never auto-grade; graded
// attempts send those answers to a training staff member for manual points.
//
// Multi-choice canonicalisation: both `correctAnswer` and `answer` are
// comma-separated value lists. We sort + lowercase both before comparing so
// "A,B,C" matches "c,b,a".

import { validChoiceOptions } from './assessment-display'

export type QuestionKind = 'text' | 'single_choice' | 'multi_choice' | 'numeric' | 'true_false'

export function normalizeSubmittedAnswer(
  kind: QuestionKind,
  rawValues: string[],
  options: unknown,
  mandatory: boolean,
): string | null {
  const values = rawValues.map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) {
    if (mandatory) throw new Error('Answer every required question before submitting')
    return null
  }

  if (kind === 'text') return values[0] ?? null
  if (kind === 'numeric') {
    const value = values[0]
    if (!value || !Number.isFinite(Number(value))) throw new Error('Enter a valid number')
    return value
  }
  if (kind === 'true_false') {
    const value = values[0]
    if (value !== 'true' && value !== 'false') throw new Error('Choose true or false')
    return value
  }

  const choices = validChoiceOptions(options)
  if (choices.length < 2) throw new Error('This assessment question has no available choices')
  const allowed = new Set(choices.map((option) => option.value))
  if (values.some((value) => !allowed.has(value))) {
    throw new Error('An answer does not match the available choices')
  }
  if (kind === 'single_choice') {
    if (values.length !== 1) throw new Error('Choose one answer')
    return values[0] ?? null
  }

  const selected = new Set(values)
  return choices
    .filter((option) => selected.has(option.value))
    .map((option) => option.value)
    .join(',')
}

/**
 * An answer while the attempt is in progress, as the attempt page edits it and
 * the device queues it: the chosen values for multi-choice, otherwise the
 * typed or chosen value ('' when unanswered).
 */
export type DraftAnswerWire = string | string[]

/** The stored answer as the values a submission carries. */
export function storedAnswerValues(kind: QuestionKind, stored: string | null): string[] {
  if (stored == null || stored === '') return []
  return kind === 'multi_choice' ? stored.split(',') : [stored]
}

/** The stored answer as the attempt page shows it. */
export function draftAnswerWire(kind: QuestionKind, stored: string | null): DraftAnswerWire {
  return kind === 'multi_choice' ? storedAnswerValues(kind, stored) : (stored ?? '')
}

/**
 * Validate an in-progress answer for its question with the submission's own
 * rules, except that leaving a question unanswered is allowed until submit.
 * Returns the value to store (null when unanswered).
 */
export function parseDraftAnswer(
  kind: QuestionKind,
  wire: unknown,
  options: unknown,
): string | null {
  let values: string[]
  if (kind === 'multi_choice') {
    if (!Array.isArray(wire) || wire.some((value) => typeof value !== 'string')) {
      throw new Error('An answer does not match the available choices')
    }
    values = wire as string[]
  } else {
    if (wire != null && typeof wire !== 'string') throw new Error('This value is invalid.')
    values = wire ? [wire] : []
  }
  return normalizeSubmittedAnswer(kind, values, options, false)
}

export function gradeAnswer(
  kind: QuestionKind,
  correctAnswer: string | null,
  userAnswer: string | null,
): boolean | null {
  if (kind === 'text') return null // never auto-grade free text
  if (userAnswer == null || userAnswer.trim().length === 0) return false
  if (correctAnswer == null || correctAnswer.trim().length === 0) return null

  const ua = userAnswer.trim()
  const ca = correctAnswer.trim()

  if (kind === 'single_choice' || kind === 'true_false') {
    return ua.toLowerCase() === ca.toLowerCase()
  }
  if (kind === 'numeric') {
    const a = Number(ua)
    const b = Number(ca)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return Math.abs(a - b) < 1e-9
  }
  if (kind === 'multi_choice') {
    const norm = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join('|')
    return norm(ua) === norm(ca)
  }
  return null
}

export function parseManualReviewPoints(rawValue: FormDataEntryValue | null, maximum: number) {
  const value = String(rawValue ?? '').trim()
  if (!/^\d+$/.test(value)) throw new Error('Enter whole-number points for every answer')
  const points = Number(value)
  if (points < 0 || points > maximum) {
    throw new Error(`Points must be between 0 and ${maximum}`)
  }
  return points
}

export function parseManualReviewNotes(rawValue: FormDataEntryValue | null) {
  const notes = String(rawValue ?? '').trim()
  if (notes.length > 2_000) throw new Error('Review notes must be 2,000 characters or fewer')
  return notes || null
}
