import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { complianceObligations, people, personWorkDays } from '@beaconhs/db/schema'
import { materializeObligation } from '@beaconhs/compliance'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { ApiError } from './errors'

const workDayInput = z
  .object({
    personId: z.string().uuid(),
    workDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`)
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
      }),
    worked: z.boolean(),
    source: z.string().trim().min(1).max(100),
  })
  .strict()

async function refresh(tx: Parameters<Parameters<RequestContext['db']>[0]>[0], tenantId: string) {
  const obligations = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.sourceModule, 'journal'),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        sql`${complianceObligations.recurrence}->>'journalDays' = 'worked_days'`,
      ),
    )
  for (const obligation of obligations)
    await materializeObligation(
      tx as Parameters<typeof materializeObligation>[0],
      tenantId,
      obligation,
    )
}

export async function upsertWorkDay(ctx: RequestContext, raw: unknown) {
  const parsed = workDayInput.safeParse(raw)
  if (!parsed.success)
    throw ApiError.invalid(
      'Expected personId, a valid workDate (YYYY-MM-DD), worked (boolean), and source',
    )
  const input = parsed.data
  return ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          eq(people.id, input.personId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
      .for('key share')
    if (!person) throw ApiError.invalid('Person not found in this tenant')
    const [before] = await tx
      .select()
      .from(personWorkDays)
      .where(
        and(
          eq(personWorkDays.tenantId, ctx.tenantId),
          eq(personWorkDays.personId, input.personId),
          eq(personWorkDays.workDate, input.workDate),
        ),
      )
      .limit(1)
    const [row] = await tx
      .insert(personWorkDays)
      .values({ tenantId: ctx.tenantId, ...input })
      .onConflictDoUpdate({
        target: [personWorkDays.tenantId, personWorkDays.personId, personWorkDays.workDate],
        set: { worked: input.worked, source: input.source, updatedAt: new Date() },
      })
      .returning()
    if (!row) throw new Error('Work-day update failed')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person_work_day',
      entityId: row.id,
      action: before ? 'update' : 'create',
      summary: 'Recorded work-day decision',
      before,
      after: row,
    })
    await refresh(tx, ctx.tenantId)
    return row
  })
}

export async function deleteWorkDay(ctx: RequestContext, id: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .delete(personWorkDays)
      .where(and(eq(personWorkDays.tenantId, ctx.tenantId), eq(personWorkDays.id, id)))
      .returning()
    if (!row) throw ApiError.notFound('Work-day decision not found')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person_work_day',
      entityId: id,
      action: 'delete',
      summary: 'Removed work-day decision; weekday fallback restored',
      before: row,
    })
    await refresh(tx, ctx.tenantId)
    return { id }
  })
}

export const WORK_DAY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['personId', 'workDate', 'worked', 'source'],
  description:
    'Upsert one employee/date work decision. Explicit false means a day off. Missing decisions remain unknown and use weekday fallback. Source is a neutral integration label; no provider is required.',
  properties: {
    personId: { type: 'string', format: 'uuid' },
    workDate: { type: 'string', format: 'date' },
    worked: { type: 'boolean' },
    source: { type: 'string', minLength: 1, maxLength: 100 },
  },
}
