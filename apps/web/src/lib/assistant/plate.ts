// The signed-in person's actual plate: the same outstanding work Workspace
// shows, not a two-list shortcut. Compliance obligations (documents to
// acknowledge, assigned forms, training, inspections, and the rest) come from
// the compliance scoreboard. Drafts, open corrective actions, and training
// expiry sit beside that. Other people are visible only with compliance.read,
// matching the Compliance hub.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import { activePeopleWhere } from '@beaconhs/db'
import {
  complianceObligations,
  complianceStatus,
  correctiveActions,
  formResponses,
  formTemplates,
  people,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { loadInProgressEntries, type InProgressEntry } from '@/app/(app)/dashboard/_metrics'
import { queryPersonCompliance } from '@/app/(app)/compliance/_hub'
import { resolveComplianceLink } from '@/app/(app)/compliance/_resolve-link'
import {
  kindLabel,
  OBLIGATION_KINDS,
  type ObligationKind,
} from '@/app/(app)/compliance/obligations/_meta'
import { addUtcDays, toPlateCompliance } from './plate-model'

const TRAINING_HORIZON_DAYS = 90
const TRAINING_CAP = 15

const OUTSTANDING = ['overdue', 'expiring', 'pending', 'in_progress'] as const

export type PlateDraft = {
  id: string
  kind: string
  title: string
  href: string
  updatedAt: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Full plate for the signed-in user. Always their own records. */
export async function loadMyPlate(ctx: RequestContext) {
  const today = todayIso()
  const horizon = addUtcDays(today, TRAINING_HORIZON_DAYS)
  return ctx.db(async (tx) => {
    const membershipId = ctx.membership?.id ?? null
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    const personId = person?.id ?? null

    const complianceRows = personId ? await queryPersonCompliance(tx, ctx.tenantId, personId) : []

    const openCaWhere = membershipId
      ? and(
          eq(correctiveActions.ownerTenantUserId, membershipId),
          isNull(correctiveActions.deletedAt),
          inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
        )
      : undefined

    const trainingBase = personId
      ? and(
          eq(trainingRecords.personId, personId),
          isNull(trainingRecords.deletedAt),
          latestTrainingRecordOnly(),
        )
      : undefined
    const expiredWhere = trainingBase
      ? and(trainingBase, lt(trainingRecords.expiresOn, today))
      : undefined
    const expiringWhere = trainingBase
      ? and(
          trainingBase,
          gte(trainingRecords.expiresOn, today),
          lte(trainingRecords.expiresOn, horizon),
        )
      : undefined

    const [
      openCorrectiveActions,
      overdueCorrectiveActions,
      expiredRows,
      expiredCount,
      expiringRows,
      expiringCount,
      drafts,
    ] = await Promise.all([
      openCaWhere
        ? tx
            .select({
              id: correctiveActions.id,
              reference: correctiveActions.reference,
              title: correctiveActions.title,
              status: correctiveActions.status,
              dueOn: correctiveActions.dueOn,
            })
            .from(correctiveActions)
            .where(openCaWhere)
            .orderBy(correctiveActions.dueOn)
            .limit(25)
        : Promise.resolve([]),
      openCaWhere
        ? tx
            .select({ c: count() })
            .from(correctiveActions)
            .where(and(openCaWhere, lt(correctiveActions.dueOn, today)))
            .then((rows) => Number(rows[0]?.c ?? 0))
        : Promise.resolve(0),
      expiredWhere
        ? tx
            .select({
              id: trainingRecords.id,
              course: trainingCourses.name,
              expiresOn: trainingRecords.expiresOn,
            })
            .from(trainingRecords)
            .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
            .where(expiredWhere)
            .orderBy(trainingRecords.expiresOn)
            .limit(TRAINING_CAP)
        : Promise.resolve([]),
      expiredWhere
        ? tx
            .select({ c: count() })
            .from(trainingRecords)
            .where(expiredWhere)
            .then((rows) => Number(rows[0]?.c ?? 0))
        : Promise.resolve(0),
      expiringWhere
        ? tx
            .select({
              id: trainingRecords.id,
              course: trainingCourses.name,
              expiresOn: trainingRecords.expiresOn,
            })
            .from(trainingRecords)
            .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
            .where(expiringWhere)
            .orderBy(trainingRecords.expiresOn)
            .limit(TRAINING_CAP)
        : Promise.resolve([]),
      expiringWhere
        ? tx
            .select({ c: count() })
            .from(trainingRecords)
            .where(expiringWhere)
            .then((rows) => Number(rows[0]?.c ?? 0))
        : Promise.resolve(0),
      membershipId ? loadInProgressEntries(tx, membershipId) : Promise.resolve([]),
    ])

    const formDrafts: PlateDraft[] = membershipId
      ? (
          await tx
            .select({
              id: formResponses.id,
              title: formTemplates.name,
              updatedAt: formResponses.updatedAt,
            })
            .from(formResponses)
            .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
            .where(
              and(
                eq(formResponses.submittedBy, membershipId),
                isNull(formResponses.deletedAt),
                inArray(formResponses.status, ['draft', 'in_progress']),
              ),
            )
            .orderBy(desc(formResponses.updatedAt))
            .limit(12)
        ).map((row) => ({
          id: row.id,
          kind: 'form',
          title: row.title?.trim() || 'Untitled form',
          href: `/apps/responses/${row.id}`,
          updatedAt:
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        }))
      : []

    const inProgress = mergeDrafts(drafts, formDrafts)
    const trainingAttention = [
      ...expiredRows.map((row) => ({ ...row, state: 'expired' as const })),
      ...expiringRows.map((row) => ({ ...row, state: 'expiring' as const })),
    ]

    return {
      asOf: today,
      trainingHorizon: horizon,
      compliance: personId
        ? toPlateCompliance(complianceRows, personId)
        : { outstanding: 0, overdue: 0, returned: 0, truncated: false, items: [] },
      inProgress,
      openCorrectiveActions,
      overdueCorrectiveActions,
      trainingAttention,
      trainingExpiredCount: expiredCount,
      trainingExpiringCount: expiringCount,
      note:
        personId === null
          ? 'No linked person profile, so compliance obligations and training could not be resolved.'
          : 'These are the signed-in user only. Drafts cannot be deleted from chat.',
    }
  })
}

function mergeDrafts(moduleDrafts: InProgressEntry[], formDrafts: PlateDraft[]): PlateDraft[] {
  const merged: PlateDraft[] = [
    ...moduleDrafts.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      href: row.href,
      updatedAt: row.updatedAt,
    })),
    ...formDrafts,
  ]
  merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return merged.slice(0, 20)
}

export function isObligationKind(value: string): value is ObligationKind {
  return (OBLIGATION_KINDS as readonly string[]).includes(value)
}

/** One person's obligations. Caller has already authorized self vs compliance.read. */
export async function loadPersonCompliance(
  ctx: RequestContext,
  personId: string,
  opts: { outstandingOnly: boolean; kind?: ObligationKind; limit: number; forSelf: boolean },
) {
  const rows = await queryPersonComplianceVia(ctx, personId)
  const filtered = rows.filter((row) => {
    if (opts.kind && row.kind !== opts.kind) return false
    if (opts.outstandingOnly && row.status === 'completed') return false
    return true
  })
  const items = filtered.slice(0, opts.limit).map((row) => ({
    obligationId: row.obligationId,
    kind: row.kind,
    kindLabel: kindLabel(row.kind),
    title: row.title,
    status: row.status,
    dueOn: row.dueOn,
    completedOn: row.completedOn,
    href: opts.forSelf
      ? (resolveComplianceLink(row.kind, row.targetRef, {
          personId,
          obligationId: row.obligationId,
        })?.href ?? null)
      : `/compliance/by-person?person=${personId}`,
  }))
  return {
    personId,
    total: filtered.length,
    returned: items.length,
    truncated: filtered.length > items.length,
    outstanding: filtered.filter((row) => row.status !== 'completed').length,
    overdue: filtered.filter((row) => row.status === 'overdue' || row.status === 'expiring').length,
    items,
  }
}

async function queryPersonComplianceVia(ctx: RequestContext, personId: string) {
  return ctx.db((tx) => queryPersonCompliance(tx, ctx.tenantId, personId))
}

/** Company-wide outstanding obligations. Requires compliance.read at the tool gate. */
export async function searchComplianceGaps(
  ctx: RequestContext,
  opts: { query?: string; kind?: ObligationKind; limit: number },
) {
  return ctx.db(async (tx) => {
    const term = opts.query?.trim()
    const like = term ? `%${term.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 100)}%` : null
    const where = and(
      eq(complianceStatus.tenantId, ctx.tenantId),
      inArray(complianceStatus.status, [...OUTSTANDING]),
      isNull(complianceObligations.deletedAt),
      eq(complianceObligations.status, 'active'),
      opts.kind ? eq(complianceObligations.sourceModule, opts.kind) : undefined,
      like
        ? or(
            ilike(complianceObligations.title, like),
            ilike(people.firstName, like),
            ilike(people.lastName, like),
            ilike(people.employeeNo, like),
          )
        : undefined,
    )
    const rank = sql`case ${complianceStatus.status}
      when 'overdue' then 0
      when 'expiring' then 1
      when 'pending' then 2
      when 'in_progress' then 3
      else 4 end`
    const [totalRow, rows] = await Promise.all([
      tx
        .select({ c: count() })
        .from(complianceStatus)
        .innerJoin(
          complianceObligations,
          eq(complianceObligations.id, complianceStatus.obligationId),
        )
        .leftJoin(people, eq(people.id, complianceStatus.personId))
        .where(where),
      tx
        .select({
          personId: complianceStatus.personId,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
          obligationId: complianceObligations.id,
          kind: complianceObligations.sourceModule,
          title: complianceObligations.title,
          status: complianceStatus.status,
          dueOn: complianceStatus.dueOn,
        })
        .from(complianceStatus)
        .innerJoin(
          complianceObligations,
          eq(complianceObligations.id, complianceStatus.obligationId),
        )
        .leftJoin(people, eq(people.id, complianceStatus.personId))
        .where(where)
        .orderBy(asc(rank), asc(complianceStatus.dueOn), asc(complianceObligations.title))
        .limit(opts.limit),
    ])
    const total = Number(totalRow[0]?.c ?? 0)
    return {
      total,
      returned: rows.length,
      truncated: total > rows.length,
      items: rows.map((row) => ({
        personId: row.personId,
        person: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || null,
        employeeNo: row.employeeNo,
        obligationId: row.obligationId,
        kind: row.kind,
        kindLabel: kindLabel(row.kind),
        title: row.title,
        status: row.status,
        dueOn: row.dueOn,
        href: row.personId ? `/compliance/by-person?person=${row.personId}` : '/compliance',
      })),
    }
  })
}

/** Active people matching a name, for a compliance.read caller. */
export async function findCompliancePeople(ctx: RequestContext, query: string, limit: number) {
  const term = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 100)}%`
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(
        and(
          activePeopleWhere(),
          or(
            ilike(people.firstName, term),
            ilike(people.lastName, term),
            ilike(people.employeeNo, term),
            ilike(people.email, term),
          ),
        ),
      )
      .orderBy(people.lastName, people.firstName)
      .limit(limit)
    return rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      employeeNo: row.employeeNo,
    }))
  })
}

export function canReadCompanyCompliance(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'compliance.read')
}

export async function selfPersonId(ctx: RequestContext): Promise<string | null> {
  return ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    return person?.id ?? null
  })
}
