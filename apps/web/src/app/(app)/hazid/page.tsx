import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { hazidAssessmentTypes, hazidAssessments, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { HazidSubNav } from './_subnav'

export const metadata = { title: 'Hazard assessments' }
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'site', 'supervisor', 'type'] as const

export default async function HazidAssessmentsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const typeFilter = pickString(sp.type)
  const statusFilter = pickString(sp.status) // 'open' | 'locked'

  const ctx = await requireRequestContext()

  const { rows, total, types, typeCounts, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(hazidAssessments.reference, term),
        ilike(hazidAssessments.locationOnSite, term),
        ilike(hazidAssessments.jobScope, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(hazidAssessments.assessmentTypeId, typeFilter))
    if (statusFilter === 'open') filters.push(eq(hazidAssessments.locked, false))
    if (statusFilter === 'locked') filters.push(eq(hazidAssessments.locked, true))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(hazidAssessments.reference)
              : desc(hazidAssessments.reference),
          ]
        : params.sort === 'site'
          ? [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]
          : params.sort === 'supervisor'
            ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
            : params.sort === 'type'
              ? [
                  params.dir === 'asc'
                    ? asc(hazidAssessmentTypes.name)
                    : desc(hazidAssessmentTypes.name),
                ]
              : [
                  params.dir === 'asc'
                    ? asc(hazidAssessments.occurredAt)
                    : desc(hazidAssessments.occurredAt),
                ]

    const [tot] = await tx.select({ c: count() }).from(hazidAssessments).where(whereClause)
    const data = await tx
      .select({
        a: hazidAssessments,
        site: orgUnits,
        supervisor: people,
        type: hazidAssessmentTypes,
      })
      .from(hazidAssessments)
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
      .leftJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const allTypes = await tx
      .select({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })
      .from(hazidAssessmentTypes)
      .orderBy(asc(hazidAssessmentTypes.name))

    const tcounts = await tx
      .select({ tid: hazidAssessments.assessmentTypeId, c: count() })
      .from(hazidAssessments)
      .groupBy(hazidAssessments.assessmentTypeId)

    const scounts = await tx
      .select({ locked: hazidAssessments.locked, c: count() })
      .from(hazidAssessments)
      .groupBy(hazidAssessments.locked)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      types: allTypes,
      typeCounts: Object.fromEntries(tcounts.map((r) => [r.tid ?? '', Number(r.c)])),
      statusCounts: {
        open: Number(scounts.find((s) => !s.locked)?.c ?? 0),
        locked: Number(scounts.find((s) => s.locked)?.c ?? 0),
      },
    }
  })

  const sortProps = { basePath: '/hazid', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid" />
          <PageHeader
            title="Hazard assessments"
            description="Job hazard analyses, confined-space entry plans, and arc-flash assessments."
            actions={
              <Link href="/hazid/new">
                <Button>New assessment</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search reference, scope, location…" />
            <FilterChips
              basePath="/hazid"
              currentParams={sp}
              paramKey="type"
              label="Type"
              options={types.map((t) => ({
                value: t.id,
                label: t.name,
                count: typeCounts[t.id],
              }))}
            />
            <FilterChips
              basePath="/hazid"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[
                { value: 'open', label: 'In progress', count: statusCounts.open },
                { value: 'locked', label: 'Locked / complete', count: statusCounts.locked },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={32} />}
          title={
            params.q || typeFilter || statusFilter
              ? 'No assessments match these filters'
              : 'No assessments yet'
          }
          description="Capture a hazard ID for a planned task before crews start work."
          action={
            <Link href="/hazid/new">
              <Button>Start an assessment</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>
                  Ref
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="occurred_at"
                  active={params.sort === 'occurred_at'}
                >
                  Date
                </SortableTh>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Type
                </SortableTh>
                <SortableTh {...sortProps} column="site" active={params.sort === 'site'}>
                  Site
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="supervisor"
                  active={params.sort === 'supervisor'}
                >
                  Supervisor
                </SortableTh>
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ a, site, supervisor, type }) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs text-slate-600">
                    <Link href={`/hazid/${a.id}`} className="hover:underline">
                      {a.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(a.occurredAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Link href={`/hazid/${a.id}`} className="text-slate-900 hover:underline">
                      {a.jobScope?.slice(0, 80) ?? <span className="text-slate-400">—</span>}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {a.locked ? (
                      <Badge variant="success">Locked</Badge>
                    ) : (
                      <Badge variant="secondary">In progress</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazid"
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
