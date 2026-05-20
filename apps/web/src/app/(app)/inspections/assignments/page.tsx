import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Calendar } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  inspectionAssignmentCompliance,
  inspectionAssignments,
  inspectionTypes,
  orgUnits,
  people,
  roles,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'
import { InspectionAssignmentsDrawers } from './_drawers'

export const metadata = { title: 'Inspection Assignments' }
export const dynamic = 'force-dynamic'

type Frequency = 'day' | 'week' | 'month' | 'quarter' | 'year'

async function createAssignmentAction(input: {
  typeId: string
  frequency: Frequency
  cron: string | null
  dueOffsetMinutes: number | null
  quantityPerPeriod: number
  compliantPercentage: number
  targetEverybody: boolean
  targetRoleKeys: string[]
  targetPersonIds: string[]
  targetOrgUnitIds: string[]
  notes: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!input.typeId) return { ok: false, error: 'Inspection type is required' }
  if (
    !input.targetEverybody &&
    input.targetRoleKeys.length === 0 &&
    input.targetPersonIds.length === 0 &&
    input.targetOrgUnitIds.length === 0
  ) {
    return {
      ok: false,
      error: 'Pick at least one audience (everyone / role / person / site).',
    }
  }
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionAssignments)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        frequency: input.frequency,
        cron: input.cron,
        dueOffsetMinutes: input.dueOffsetMinutes,
        quantityPerPeriod: input.quantityPerPeriod,
        compliantPercentage: input.compliantPercentage,
        targetEverybody: input.targetEverybody,
        targetRoleKeys: input.targetRoleKeys,
        targetPersonIds: input.targetPersonIds,
        targetOrgUnitIds: input.targetOrgUnitIds,
        notes: input.notes,
        enabled: true,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })
  if (!row) return { ok: false, error: 'Failed to create assignment' }
  await recordAudit(ctx, {
    entityType: 'inspection_assignment',
    entityId: row.id,
    action: 'create',
    summary: `Created assignment for inspection type ${input.typeId.slice(0, 8)} (${input.frequency})`,
    after: {
      typeId: input.typeId,
      frequency: input.frequency,
      quantityPerPeriod: input.quantityPerPeriod,
      compliantPercentage: input.compliantPercentage,
      targetEverybody: input.targetEverybody,
      targetRoleKeys: input.targetRoleKeys,
      targetPersonIds: input.targetPersonIds,
      targetOrgUnitIds: input.targetOrgUnitIds,
    },
  })
  revalidatePath('/inspections/assignments')
  return { ok: true, id: row.id }
}

const SORTS = ['type', 'frequency', 'next_due'] as const

const ENABLED_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]

export default async function InspectionAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'next_due',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const enabledFilter = pickString(sp.enabled)
  const ctx = await requireRequestContext()

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const c = ilike(inspectionTypes.name, term)
      if (c) filters.push(c)
    }
    if (enabledFilter === 'enabled') filters.push(eq(inspectionAssignments.enabled, true))
    if (enabledFilter === 'disabled') filters.push(eq(inspectionAssignments.enabled, false))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'type'
        ? [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]
        : params.sort === 'frequency'
          ? [
              params.dir === 'asc'
                ? asc(inspectionAssignments.frequency)
                : desc(inspectionAssignments.frequency),
            ]
          : [
              params.dir === 'asc'
                ? asc(inspectionAssignments.nextDueAt)
                : desc(inspectionAssignments.nextDueAt),
            ]

    const [tot] = await tx
      .select({ c: count() })
      .from(inspectionAssignments)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionAssignments.typeId))
      .where(whereClause)

    const data = await tx
      .select({
        assignment: inspectionAssignments,
        type: inspectionTypes,
      })
      .from(inspectionAssignments)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionAssignments.typeId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  // Drawer audience + type options
  const [typeOptions, roleOptions, peopleOptions, siteOptions] = await ctx.db(async (tx) => {
    const tt = await tx
      .select({
        id: inspectionTypes.id,
        name: inspectionTypes.name,
        defaultCadence: inspectionTypes.defaultCadence,
      })
      .from(inspectionTypes)
      .where(eq(inspectionTypes.isPublished, true))
      .orderBy(asc(inspectionTypes.name))
    const rr = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    const pp = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    const ss = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return [tt, rr, pp, ss] as const
  })

  const openDrawer = pickString(sp.drawer) === 'new-assignment' ? 'new-assignment' : null

  // For each row compute compliance snapshot — single query, group in JS.
  const assignmentIds = rows.map((r) => r.assignment.id)
  const complianceByAssignment = new Map<string, { avg: number; assignees: number }>()
  if (assignmentIds.length > 0) {
    const compRows = await ctx.db((tx) =>
      tx
        .select()
        .from(inspectionAssignmentCompliance)
        .where(
          assignmentIds.length === 1
            ? eq(inspectionAssignmentCompliance.assignmentId, assignmentIds[0]!)
            : undefined,
        ),
    )
    const grouped = new Map<string, { sum: number; n: number }>()
    for (const c of compRows) {
      const g = grouped.get(c.assignmentId) ?? { sum: 0, n: 0 }
      g.sum += c.overallPercent
      g.n += 1
      grouped.set(c.assignmentId, g)
    }
    for (const [aid, g] of grouped) {
      complianceByAssignment.set(aid, {
        avg: g.n > 0 ? Math.round(g.sum / g.n) : 0,
        assignees: g.n,
      })
    }
  }

  const sortProps = { basePath: '/inspections/assignments', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspection Assignments"
            description="Recurring duties — pick a type, pick an audience, set a cadence. Compliance % is computed against recent records."
            actions={
              <Link href="/inspections/assignments?drawer=new-assignment" scroll={false}>
                <Button>New assignment</Button>
              </Link>
            }
          />
          <InspectionsSubNav active="assignments" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by type name" />
          </div>
          <FilterChips
            basePath="/inspections/assignments"
            currentParams={sp}
            paramKey="enabled"
            label="Status"
            options={ENABLED_OPTIONS}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Calendar size={32} />}
          title={params.q ? `No assignments match "${params.q}"` : 'No inspection assignments yet'}
          description="Set up a recurring assignment so the right people complete the right inspection on cadence."
          action={
            <Link href="/inspections/assignments?drawer=new-assignment" scroll={false}>
              <Button>New assignment</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Inspection type
                </SortableTh>
                <TableHead>Audience</TableHead>
                <SortableTh {...sortProps} column="frequency" active={params.sort === 'frequency'}>
                  Cadence
                </SortableTh>
                <SortableTh {...sortProps} column="next_due" active={params.sort === 'next_due'}>
                  Next due
                </SortableTh>
                <TableHead>Last fired</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ assignment, type }) => {
                const comp = complianceByAssignment.get(assignment.id)
                const audienceLabel = describeAudience(assignment)
                return (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <Link
                        href={`/inspections/assignments/${assignment.id}`}
                        className="font-medium hover:underline"
                      >
                        {type.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{audienceLabel}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {assignment.quantityPerPeriod} / {assignment.frequency}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {assignment.nextDueAt
                        ? new Date(assignment.nextDueAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {assignment.lastFiredAt
                        ? new Date(assignment.lastFiredAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {comp ? (
                        <div className="flex items-center gap-2 text-xs">
                          <Badge
                            variant={
                              comp.avg >= assignment.compliantPercentage
                                ? 'success'
                                : comp.avg >= Math.floor(assignment.compliantPercentage / 2)
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {comp.avg}%
                          </Badge>
                          <span className="text-slate-400">({comp.assignees})</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">not computed</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={assignment.enabled ? 'success' : 'secondary'}>
                        {assignment.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/inspections/assignments"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <InspectionAssignmentsDrawers
        openDrawer={openDrawer}
        closeHref="/inspections/assignments"
        typeOptions={typeOptions}
        roleOptions={roleOptions}
        peopleOptions={peopleOptions}
        siteOptions={siteOptions}
        createAssignmentAction={createAssignmentAction}
      />
    </ListPageLayout>
  )
}

function describeAudience(a: {
  targetEverybody: boolean
  targetRoleKeys: string[]
  targetPersonIds: string[]
  targetOrgUnitIds: string[]
}): string {
  const parts: string[] = []
  if (a.targetEverybody) parts.push('Everyone')
  if (a.targetRoleKeys.length > 0) parts.push(`${a.targetRoleKeys.length} role${a.targetRoleKeys.length === 1 ? '' : 's'}`)
  if (a.targetPersonIds.length > 0)
    parts.push(`${a.targetPersonIds.length} person${a.targetPersonIds.length === 1 ? '' : 's'}`)
  if (a.targetOrgUnitIds.length > 0)
    parts.push(`${a.targetOrgUnitIds.length} site${a.targetOrgUnitIds.length === 1 ? '' : 's'}`)
  return parts.length === 0 ? '—' : parts.join(', ')
}
