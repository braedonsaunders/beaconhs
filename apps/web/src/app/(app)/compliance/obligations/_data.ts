// Read model for the unified obligations management surface. Now a SINGLE query
// over `compliance_obligations` (+ audience counts), and live compliance via the
// evaluation adapters. The old per-module UNION is gone.

import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { describeRecurrence } from '@/components/recurrence'
import { and, count, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm'
import {
  complianceAudience,
  complianceObligations,
  compliancePeriodSnapshots,
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import {
  type AudienceItem,
  evaluateObligation,
  resolveComplianceClock,
  resolveObligationAudience,
  resolveFrequencyWindow,
  isInSeason,
} from '@beaconhs/compliance'
import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import type { ObligationKind } from './_meta'
import { isCalendarQuantity } from './_meta'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

type ObligationRow = {
  kind: ObligationKind
  id: string
  title: string
  audience: string
  cadence: string
  enabled: boolean
}

type ObligationListResult = { rows: ObligationRow[]; total: number }

export async function listObligations(
  ctx: Ctx,
  opts: { kind?: ObligationKind; q?: string; page?: number; perPage?: number } = {},
): Promise<ObligationListResult> {
  const translate = await getGeneratedValueTranslations()
  const perPage = opts.perPage ?? 25
  const page = Math.max(1, opts.page ?? 1)
  return ctx.db(async (tx) => {
    const where = and(
      eq(complianceObligations.tenantId, ctx.tenantId),
      isNull(complianceObligations.deletedAt),
      ne(complianceObligations.status, 'archived'),
      opts.kind ? eq(complianceObligations.sourceModule, opts.kind) : undefined,
      opts.q ? ilike(complianceObligations.title, `%${opts.q}%`) : undefined,
    )

    const [tot] = await tx.select({ c: count() }).from(complianceObligations).where(where)
    const total = Number(tot?.c ?? 0)

    const obs = await tx
      .select()
      .from(complianceObligations)
      .where(where)
      .orderBy(desc(complianceObligations.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)

    const ids = obs.map((o) => o.id)
    const counts = new Map<string, { n: number; everyone: boolean; excluded: number }>()
    if (ids.length > 0) {
      const ac = await tx
        .select({
          id: complianceAudience.obligationId,
          n: sql<number>`count(*) filter (where not ${complianceAudience.excluded})`.mapWith(
            Number,
          ),
          excluded: sql<number>`count(*) filter (where ${complianceAudience.excluded})`.mapWith(
            Number,
          ),
          everyone: sql<boolean>`bool_or(${complianceAudience.kind} = 'everyone' and not ${complianceAudience.excluded})`,
        })
        .from(complianceAudience)
        .where(inArray(complianceAudience.obligationId, ids))
        .groupBy(complianceAudience.obligationId)
      const audienceRows = await tx
        .select({
          id: complianceAudience.obligationId,
          kind: complianceAudience.kind,
          entityKey: complianceAudience.entityKey,
          excluded: complianceAudience.excluded,
        })
        .from(complianceAudience)
        .where(inArray(complianceAudience.obligationId, ids))
      const byObligation = new Map<string, AudienceItem[]>()
      for (const row of audienceRows) {
        const items = byObligation.get(row.id) ?? []
        items.push({
          kind: row.kind as AudienceItem['kind'],
          entityKey: row.entityKey,
          excluded: row.excluded,
        })
        byObligation.set(row.id, items)
      }
      for (const r of ac) {
        const obligation = obs.find((item) => item.id === r.id)
        const activeMemberCount = obligation
          ? (
              await resolveObligationAudience(
                tx,
                ctx.tenantId,
                byObligation.get(r.id) ?? [],
                obligation.workerType,
              )
            ).length
          : 0
        counts.set(r.id, { n: activeMemberCount, everyone: r.everyone, excluded: r.excluded })
      }
    }

    const rows = obs.map((o) => {
      const audienceInfo = counts.get(o.id)
      return {
        kind: o.sourceModule as ObligationKind,
        id: o.id,
        title: o.title,
        audience:
          o.subjectKind === 'per_record'
            ? 'Records'
            : o.subjectKind === 'per_task'
              ? `${translate(o.workerType === 'employee' ? 'Employees' : o.workerType === 'contractor' ? 'Contractors' : 'All worker types')} · ${translate('Title holders')}`
              : !audienceInfo || audienceInfo.n === 0
                ? 'No audience'
                : audienceInfo.everyone
                  ? `${translate(o.workerType === 'employee' ? 'Employees' : o.workerType === 'contractor' ? 'Contractors' : 'Everyone')}${audienceInfo?.excluded ? ` · ${audienceInfo.excluded} exclusions` : ''}`
                  : `${o.workerType === 'all' ? '' : `${translate(o.workerType === 'employee' ? 'Employees' : 'Contractors')} · `}${audienceInfo.n} target${audienceInfo.n === 1 ? '' : 's'}${audienceInfo.excluded ? ` · ${audienceInfo.excluded} exclusions` : ''}`,
        cadence: describeRecurrence(o.recurrence, translate),
        enabled: o.status === 'active',
      }
    })
    return { rows, total }
  })
}

async function getObligationWithAudience(ctx: Ctx, id: string) {
  return ctx.db(async (tx) => {
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
      .limit(1)
    if (!ob || ob.deletedAt) return null
    const aud = await tx
      .select({
        kind: complianceAudience.kind,
        entityKey: complianceAudience.entityKey,
        excluded: complianceAudience.excluded,
      })
      .from(complianceAudience)
      .where(eq(complianceAudience.obligationId, id))
    const audience: AudienceItem[] = aud.map((a) => ({
      kind: a.kind as AudienceItem['kind'],
      entityKey: a.entityKey,
      excluded: a.excluded,
    }))
    return { ob, audience }
  })
}

export async function obligationCompliance(ctx: Ctx, id: string) {
  const data = await getObligationWithAudience(ctx, id)
  if (!data) return null
  const evaluated = await ctx.db(async (tx) => {
    const clock = await resolveComplianceClock(tx, ctx.tenantId)
    const calendarQuantity = isCalendarQuantity(data.ob)
    const period = calendarQuantity
      ? resolveFrequencyWindow(data.ob.recurrence, clock, data.ob.createdAt)
      : null
    const [snapshot] = await tx
      .select({ id: compliancePeriodSnapshots.id })
      .from(compliancePeriodSnapshots)
      .where(eq(compliancePeriodSnapshots.obligationId, id))
      .limit(1)
    return {
      hasHistory: Boolean(snapshot),
      result: await evaluateObligation(tx, ctx.tenantId, data.ob, data.audience, clock),
      period,
      seasonActive: isInSeason(data.ob.recurrence, clock),
    }
  })
  return { obligation: data.ob, audience: data.audience, ...evaluated }
}
