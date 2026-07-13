import { z } from 'zod'
import { computeSafeDistance, segmentVolumeM3 } from './_lib'
import {
  MAX_SAFE_DISTANCE_DESCRIPTION_LENGTH,
  MAX_SAFE_DISTANCE_NAME_LENGTH,
  MAX_SAFE_DISTANCE_NOTES_LENGTH,
  MAX_SAFE_DISTANCE_SEGMENT_MEASUREMENT,
  MAX_SAFE_DISTANCE_SEGMENT_NAME_LENGTH,
  MAX_SAFE_DISTANCE_SEGMENTS,
  MAX_SAFE_DISTANCE_TEST_PRESSURE,
  MAX_SAFE_DISTANCE_TOTAL_VOLUME_M3,
} from './_constraints'

const versionSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}, 'The assessment version is invalid.')

const optionalUuidSchema = z.string().uuid().nullable()

const segmentSchema = z
  .object({
    name: z.string().max(MAX_SAFE_DISTANCE_SEGMENT_NAME_LENGTH).nullable().optional(),
    unit: z.enum(['inch', 'feet', 'mm', 'cm', 'm']),
    lengthValue: z.number().finite().positive().max(MAX_SAFE_DISTANCE_SEGMENT_MEASUREMENT),
    internalDiameter: z.number().finite().positive().max(MAX_SAFE_DISTANCE_SEGMENT_MEASUREMENT),
  })
  .strict()

const saveSchema = z
  .object({
    id: z.string().uuid(),
    version: versionSchema,
    name: z.string().trim().min(1).max(MAX_SAFE_DISTANCE_NAME_LENGTH),
    method: z.enum(['nasa', 'asme', 'lloyds']),
    unit: z.enum(['metric', 'imperial']),
    testPressure: z.number().finite().positive().max(MAX_SAFE_DISTANCE_TEST_PRESSURE),
    description: z.string().max(MAX_SAFE_DISTANCE_DESCRIPTION_LENGTH).nullable().optional(),
    siteOrgUnitId: optionalUuidSchema.optional(),
    supervisorTenantUserId: optionalUuidSchema.optional(),
    operatorPersonId: optionalUuidSchema.optional(),
    notes: z.string().max(MAX_SAFE_DISTANCE_NOTES_LENGTH).nullable().optional(),
    segments: z.array(segmentSchema).min(1).max(MAX_SAFE_DISTANCE_SEGMENTS),
  })
  .strict()

const identitySchema = z
  .object({
    id: z.string().uuid(),
    version: versionSchema,
  })
  .strict()

export type SafeDistanceSaveInput = z.input<typeof saveSchema>
type ValidSafeDistanceSave = z.output<typeof saveSchema> & {
  description: string | null
  siteOrgUnitId: string | null
  supervisorTenantUserId: string | null
  operatorPersonId: string | null
  notes: string | null
  segments: Array<{
    name: string | null
    unit: 'inch' | 'feet' | 'mm' | 'cm' | 'm'
    lengthValue: number
    internalDiameter: number
  }>
  results: ReturnType<typeof computeSafeDistance>
}

type PolicyResult<T> = { ok: true; value: T } | { ok: false; error: string }

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'The assessment data is invalid.'
  const field = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${field}${issue.message}`
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

export function parseSafeDistanceSave(input: unknown): PolicyResult<ValidSafeDistanceSave> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: issueMessage(parsed.error) }

  const segments = parsed.data.segments.map((segment) => ({
    ...segment,
    name: trimmedOrNull(segment.name),
  }))
  const results = computeSafeDistance({
    method: parsed.data.method,
    unit: parsed.data.unit,
    testPressure: parsed.data.testPressure,
    segments,
  })
  const values = [
    results.totalVolume,
    results.totalVolumeM3,
    results.nasa,
    results.asme,
    results.lloyds,
    results.chosen,
  ]
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ok: false, error: 'The calculation produced an invalid result.' }
  }
  if (results.totalVolumeM3 > MAX_SAFE_DISTANCE_TOTAL_VOLUME_M3) {
    return { ok: false, error: 'The combined piping volume is outside the supported range.' }
  }
  if (
    segments.some(
      (segment) =>
        segmentVolumeM3(segment.lengthValue, segment.internalDiameter, segment.unit) >
        MAX_SAFE_DISTANCE_TOTAL_VOLUME_M3,
    )
  ) {
    return { ok: false, error: 'A pipe segment is outside the supported volume range.' }
  }

  return {
    ok: true,
    value: {
      ...parsed.data,
      version: new Date(parsed.data.version).toISOString(),
      description: trimmedOrNull(parsed.data.description),
      siteOrgUnitId: parsed.data.siteOrgUnitId ?? null,
      supervisorTenantUserId: parsed.data.supervisorTenantUserId ?? null,
      operatorPersonId: parsed.data.operatorPersonId ?? null,
      notes: trimmedOrNull(parsed.data.notes),
      segments,
      results,
    },
  }
}

export function parseSafeDistanceIdentity(
  input: unknown,
): PolicyResult<{ id: string; version: string }> {
  const parsed = identitySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: issueMessage(parsed.error) }
  return {
    ok: true,
    value: { id: parsed.data.id, version: new Date(parsed.data.version).toISOString() },
  }
}

type SafeDistanceStateMutation =
  | { kind: 'save' }
  | { kind: 'delete' }
  | { kind: 'set_lock'; locked: boolean }

type SafeDistanceStateDecision =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; reason: 'locked' | 'conflict' }

/**
 * Evaluated while the record row is held FOR UPDATE. The version prevents a
 * stale tab from overwriting a newer calculation, while the lock check ensures
 * a save/delete queued before a lock cannot proceed after that lock commits.
 */
export function evaluateSafeDistanceState(
  row: { locked: boolean; updatedAt: Date },
  expectedVersion: string,
  mutation: SafeDistanceStateMutation,
): SafeDistanceStateDecision {
  if (mutation.kind === 'set_lock' && row.locked === mutation.locked) {
    return { ok: true, changed: false }
  }
  if (mutation.kind !== 'set_lock' && row.locked) {
    return { ok: false, error: 'This assessment is locked.', reason: 'locked' }
  }
  if (row.updatedAt.getTime() !== new Date(expectedVersion).getTime()) {
    return {
      ok: false,
      error: 'This assessment changed in another session. Refresh it and try again.',
      reason: 'conflict',
    }
  }
  return { ok: true, changed: true }
}
