import Link from 'next/link'
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
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'

export const metadata = { title: 'Inspection Assignments' }
export const dynamic = 'force-dynamic'

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
              <Link href="/inspections/assignments/new">
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
            <Link href="/inspections/assignments/new">
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
