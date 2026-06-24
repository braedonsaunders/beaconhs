// Write handlers for the public API. Writes do NOT go through the read registry
// (that includes views and only a reporting subset of columns) — each writable
// entity has a hand-written, validated create that mirrors the real server
// action: zod-validated body, tenant-scoped FK checks, insert, audit. Adding an
// entity = add a handler here; `WRITABLE_ENTITY_KEYS` is derived from this map,
// so scopes/OpenAPI stay in sync.

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { people, trainingCourses, trainingRecords, trainingRecordSource } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { ApiError } from './errors'

type Json = Record<string, unknown>
export type WriteResult = { id: string; [k: string]: unknown }
type WriteHandler = (ctx: RequestContext, body: unknown) => Promise<WriteResult>

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'Expected a uuid',
})
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected a date (YYYY-MM-DD)' })

// --- training_records --------------------------------------------------------

const trainingRecordCreate = z.object({
  personId: uuid,
  courseId: uuid,
  completedOn: isoDate,
  source: z.enum(trainingRecordSource.enumValues).default('external_upload'),
  expiresOn: isoDate.nullish(),
  score: z.number().int().nullish(),
  grade: z.number().int().min(0).max(100).nullish(),
  instructor: z.string().max(200).nullish(),
  evaluatorPersonId: uuid.nullish(),
  details: z.string().max(2000).nullish(),
  notes: z.string().max(2000).nullish(),
})

async function createTrainingRecord(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = trainingRecordCreate.safeParse(raw)
  if (!parsed.success) {
    throw ApiError.invalid(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    // FK existence is checked under RLS so a caller can't reference another
    // tenant's person/course (the FK targets are global PKs; RLS scopes the read).
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, b.personId))
      .limit(1)
    if (!person) throw ApiError.invalid(`No person with id ${b.personId} in this tenant`)
    const [course] = await tx
      .select({ id: trainingCourses.id })
      .from(trainingCourses)
      .where(eq(trainingCourses.id, b.courseId))
      .limit(1)
    if (!course) throw ApiError.invalid(`No training course with id ${b.courseId} in this tenant`)

    const [created] = await tx
      .insert(trainingRecords)
      .values({
        tenantId: ctx.tenantId,
        personId: b.personId,
        courseId: b.courseId,
        source: b.source,
        completedOn: b.completedOn,
        expiresOn: b.expiresOn ?? null,
        score: b.score ?? null,
        grade: b.grade ?? null,
        instructor: b.instructor ?? null,
        evaluatorPersonId: b.evaluatorPersonId ?? null,
        details: b.details ?? null,
        notes: b.notes ?? null,
        issuedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning()
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create training record')
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: row.id,
    action: 'create',
    summary: 'Created training record via API',
    after: {
      personId: row.personId,
      courseId: row.courseId,
      source: row.source,
      completedOn: row.completedOn,
    },
  })

  return {
    id: row.id,
    personId: row.personId,
    courseId: row.courseId,
    source: row.source,
    completedOn: row.completedOn,
    expiresOn: row.expiresOn ?? null,
    score: row.score ?? null,
    grade: row.grade ?? null,
  }
}

// OpenAPI requestBody schema, co-located with the validator so docs match.
const TRAINING_RECORD_BODY: Json = {
  type: 'object',
  required: ['personId', 'courseId', 'completedOn'],
  properties: {
    personId: {
      type: 'string',
      format: 'uuid',
      description: 'Person earning the training (must belong to your tenant).',
    },
    courseId: {
      type: 'string',
      format: 'uuid',
      description: 'Training course (must belong to your tenant).',
    },
    completedOn: { type: 'string', format: 'date' },
    source: {
      type: 'string',
      enum: trainingRecordSource.enumValues,
      default: 'external_upload',
    },
    expiresOn: { type: 'string', format: 'date' },
    score: { type: 'integer' },
    grade: { type: 'integer', minimum: 0, maximum: 100 },
    instructor: { type: 'string' },
    evaluatorPersonId: { type: 'string', format: 'uuid' },
    details: { type: 'string' },
    notes: { type: 'string' },
  },
}

// --- registry ----------------------------------------------------------------

const HANDLERS: Record<string, WriteHandler> = {
  training_records: createTrainingRecord,
}

const WRITE_BODIES: Record<string, Json> = {
  training_records: TRAINING_RECORD_BODY,
}

/** Entity keys that accept POST creates — the single source of truth. */
export const WRITABLE_ENTITY_KEYS = Object.keys(HANDLERS)

export function isWritable(entityKey: string): boolean {
  return entityKey in HANDLERS
}

/** OpenAPI requestBody schema for a writable entity, or null. */
export function writeBodySchema(entityKey: string): Json | null {
  return WRITE_BODIES[entityKey] ?? null
}

export async function createEntity(
  ctx: RequestContext,
  entityKey: string,
  body: unknown,
): Promise<WriteResult> {
  const handler = HANDLERS[entityKey]
  if (!handler) throw ApiError.methodNotAllowed(`Writes are not supported for "${entityKey}"`)
  return handler(ctx, body)
}
