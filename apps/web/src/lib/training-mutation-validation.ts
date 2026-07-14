import {
  optionalTextInput,
  optionalUuidInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from './mutation-input'

export const TRAINING_CONTENT_KINDS = ['rich', 'video', 'file', 'embed', 'slides'] as const

export const TRAINING_LESSON_KINDS = [
  'rich',
  'video',
  'file',
  'embed',
  'quiz',
  'session',
  'slides',
  'practical',
] as const
export type TrainingLessonKind = (typeof TRAINING_LESSON_KINDS)[number]

export const TRAINING_COMPLETION_RULES = [
  'view',
  'pass',
  'acknowledge',
  'min_time',
  'evaluator',
] as const
export type TrainingCompletionRule = (typeof TRAINING_COMPLETION_RULES)[number]

const TRAINING_OPEN_ENROLLMENT_STATUSES = ['in_progress'] as const

export const MAX_TRAINING_DURATION_MINUTES = 525_600
export const MAX_TRAINING_VALIDITY_MONTHS = 1_200
const MAX_TRAINING_ORDER_ITEMS = 5_000
const MAX_PRACTICAL_CRITERIA = 100

export const requireTrainingUuid = requireUuidInput
export const optionalTrainingUuid = optionalUuidInput
export const requireTrainingEnum = requireEnumInput
export const requiredTrainingText = requiredTextInput
export const optionalTrainingText = optionalTextInput

export function optionalTrainingInteger(value: unknown, label: string, max: number): number | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return null
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a whole number.`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${label} must be between 0 and ${max}.`)
  }
  return parsed
}

export function parseTrainingTags(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : ''
  const tags = [
    ...new Set(
      raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
  if (tags.length > 50) throw new Error('Use no more than 50 tags.')
  if (tags.some((tag) => tag.length > 80))
    throw new Error('Each tag must be 80 characters or less.')
  return tags
}

type ValidatedPracticalCriterion = { id: string; text: string }

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function parsePracticalCriteria(value: unknown): ValidatedPracticalCriterion[] | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 100_000) {
    throw new Error('Practical criteria are invalid.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Practical criteria are invalid.')
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_PRACTICAL_CRITERIA) {
    throw new Error(`Use no more than ${MAX_PRACTICAL_CRITERIA} practical criteria.`)
  }

  const ids = new Set<string>()
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Practical criteria are invalid.')
    const candidate = entry as { id?: unknown; text?: unknown }
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
    if (
      !id ||
      id.length > 100 ||
      !/^[A-Za-z0-9_-]+$/.test(id) ||
      UNSAFE_OBJECT_KEYS.has(id) ||
      ids.has(id)
    ) {
      throw new Error('Each practical criterion must have a unique valid id.')
    }
    if (text.length > 1_000) throw new Error('Practical criterion text is too long.')
    ids.add(id)
    return { id, text }
  })
}

export function parsePracticalEvaluationResults(
  value: unknown,
  criteria: readonly ValidatedPracticalCriterion[],
  pass: boolean,
): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Practical evaluation results are invalid.')
  }
  const submitted = value as Record<string, unknown>
  const criterionIds = new Set(criteria.map((criterion) => criterion.id))
  const submittedIds = Object.keys(submitted)
  if (
    submittedIds.length > MAX_PRACTICAL_CRITERIA ||
    submittedIds.some((id) => !criterionIds.has(id))
  ) {
    throw new Error('Practical evaluation results are invalid.')
  }

  const normalized = Object.fromEntries(
    criteria.map((criterion) => {
      const result = submitted[criterion.id]
      if (result !== undefined && typeof result !== 'boolean') {
        throw new Error('Practical evaluation results are invalid.')
      }
      return [criterion.id, result === true]
    }),
  )
  if (pass && Object.values(normalized).some((result) => !result)) {
    throw new Error('Every practical criterion must pass before sign-off.')
  }
  return normalized
}

export function parseTrainingOrder(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRAINING_ORDER_ITEMS) {
    throw new Error(`${label} order is invalid.`)
  }
  const ids = value.map((id) => requireTrainingUuid(id, label))
  if (new Set(ids).size !== ids.length) throw new Error(`${label} order contains duplicates.`)
  return ids
}

export function assertExactTrainingOrder(
  actualIds: readonly string[],
  orderedIds: readonly string[],
  label: string,
): void {
  if (actualIds.length !== orderedIds.length || actualIds.some((id) => !orderedIds.includes(id))) {
    throw new Error(`${label} order is stale or contains unrelated records.`)
  }
}

export function assertLessonCourse(enrollmentCourseId: string, lessonCourseId: string): void {
  if (enrollmentCourseId !== lessonCourseId) throw new Error('Lesson not found')
}

export function assertTrainingEnrollmentOpen(status: unknown): void {
  if (!TRAINING_OPEN_ENROLLMENT_STATUSES.some((candidate) => candidate === status)) {
    throw new Error('Enrollment is not active.')
  }
}

export function minimumTimeRemainingSeconds(
  startedAt: Date | null,
  minimumSeconds: number | null,
  now: Date = new Date(),
): number {
  if (!minimumSeconds || minimumSeconds <= 0) return 0
  if (!startedAt) return minimumSeconds
  const elapsed = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000))
  return Math.max(0, minimumSeconds - elapsed)
}
