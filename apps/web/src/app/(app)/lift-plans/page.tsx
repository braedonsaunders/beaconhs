import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
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
  liftPlanSignatures,
  liftPlans,
  orgUnits,
  tenantUsers,
} from '@beaconhs/db/schema'
import { alias } from 'drizzle-orm/pg-core'
import { StatusBadge } from './_badges'
import { LIFT_PLAN_STATUSES } from './_types'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Lift Plans' }
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'lift_date', 'status', 'site', 'project', 'completed', 'created_at'] as const

const STATUS_OPTIONS = LIFT_PLAN_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '),
}))

export default async function LiftPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'lift_date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const supervisorFilter = pickString(sp.supervisor)
  const projectFilter = pickString(sp.project)
  const siteFilter = pickString(sp.site)
  const dateFromRaw = pickString(sp.dateFrom)
  const dateToRaw = pickString(sp.dateTo)

  const ctx = await requireRequestContext()

  // Aliased orgUnits join — one for the site, one for the project (so a plan
  // attached to both is rendered with each column independently).
  const siteUnits = alias(orgUnits, 'site_units')
  const projectUnits = alias(orgUnits, 'project_units')

  const { rows, total, statusCounts, supervisors, projects, sites } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(liftPlans.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(liftPlans.reference, term), ilike(liftPlans.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter && (LIFT_PLAN_STATUSES as readonly string[]).includes(statusFilter)) {
      filters.push(eq(liftPlans.status, statusFilter as (typeof LIFT_PLAN_STATUSES)[number]))
    }
    if (supervisorFilter) filters.push(eq(liftPlans.supervisorTenantUserId, supervisorFilter))
    if (projectFilter) filters.push(eq(liftPlans.projectOrgUnitId, projectFilter))
    if (siteFilter) filters.push(eq(liftPlans.siteOrgUnitId, siteFilter))
    if (dateFromRaw) filters.push(gte(liftPlans.liftDate, dateFromRaw))
    if (dateToRaw) filters.push(lte(liftPlans.liftDate, dateToRaw))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(liftPlans.reference) : desc(liftPlans.reference)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(liftPlans.status) : desc(liftPlans.status)]
          : params.sort === 'site'
            ? [params.dir === 'asc' ? asc(siteUnits.name) : desc(siteUnits.name)]
            : params.sort === 'project'
              ? [params.dir === 'asc' ? asc(projectUnits.name) : desc(projectUnits.name)]
              : params.sort === 'completed'
                ? [params.dir === 'asc' ? asc(liftPlans.completedAt) : desc(liftPlans.completedAt)]
                : params.sort === 'created_at'
                  ? [params.dir === 'asc' ? asc(liftPlans.createdAt) : desc(liftPlans.createdAt)]
                  : [params.dir === 'asc' ? asc(liftPlans.liftDate) : desc(liftPlans.liftDate)]

    const [tot] = await tx.select({ c: count() }).from(liftPlans).where(whereClause)

    const data = await tx
      .select({
        plan: liftPlans,
        site: siteUnits,
        project: projectUnits,
        supervisor: tenantUsers,
        signatureCount: sql<number>`count(distinct ${liftPlanSignatures.id})`.mapWith(Number),
      })
      .from(liftPlans)
      .leftJoin(siteUnits, eq(siteUnits.id, liftPlans.siteOrgUnitId))
      .leftJoin(projectUnits, eq(projectUnits.id, liftPlans.projectOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, liftPlans.supervisorTenantUserId))
      .leftJoin(liftPlanSignatures, eq(liftPlanSignatures.liftPlanId, liftPlans.id))
      .where(whereClause)
      .groupBy(liftPlans.id, siteUnits.id, projectUnits.id, tenantUsers.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const statuses = await tx
      .select({ status: liftPlans.status, c: count() })
      .from(liftPlans)
      .where(isNull(liftPlans.deletedAt))
      .groupBy(liftPlans.status)

    const supervisors = await tx
      .select({ id: tenantUsers.id, displayName: tenantUsers.displayName })
      .from(tenantUsers)
      .innerJoin(liftPlans, eq(liftPlans.supervisorTenantUserId, tenantUsers.id))
      .where(isNull(liftPlans.deletedAt))
      .groupBy(tenantUsers.id, tenantUsers.displayName)
      .orderBy(asc(tenantUsers.displayName))
      .limit(50)

    const projects = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'project'))
      .orderBy(asc(orgUnits.name))
      .limit(50)

    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
      .limit(50)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
      supervisors,
      projects,
      sites,
    }
  })

  const sortProps = { basePath: '/lift-plans', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Lift Plans"
            description="Critical lift engineering plans — loads, equipment, hazards, sign-off."
            actions={
              <Link href="/lift-plans/new">
                <Button>New lift plan</Button>
              </Link>
            }
          />

          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search reference, description…" />
            <DateRangeInputs from={dateFromRaw} to={dateToRaw} currentParams={sp} />
          </div>
          <div className="space-y-2">
            <FilterChips
              basePath="/lift-plans"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            {supervisors.length > 0 ? (
              <FilterChips
                basePath="/lift-plans"
                currentParams={sp}
                paramKey="supervisor"
                label="Supervisor"
                options={supervisors.map((s) => ({
                  value: s.id,
                  label: s.displayName ?? 'Unnamed',
                }))}
              />
            ) : null}
            {projects.length > 0 ? (
              <FilterChips
                basePath="/lift-plans"
                currentParams={sp}
                paramKey="project"
                label="Project"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : null}
            {sites.length > 0 ? (
              <FilterChips
                basePath="/lift-plans"
                currentParams={sp}
                paramKey="site"
                label="Site"
                options={sites.map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ArrowUpRight size={32} />}
          title={
            params.q || statusFilter || projectFilter || supervisorFilter
              ? 'No lift plans match these filters'
              : 'No lift plans yet'
          }
          description="Create the first lift plan to engineer a critical lift end-to-end — load, crane, capacity check, hazards, sign-off."
          action={
            <Link href="/lift-plans/new">
              <Button>New lift plan</Button>
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
                <SortableTh {...sortProps} column="project" active={params.sort === 'project'}>
                  Project
                </SortableTh>
                <SortableTh {...sortProps} column="site" active={params.sort === 'site'}>
                  Site
                </SortableTh>
                <TableHead>Supervisor</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <SortableTh {...sortProps} column="lift_date" active={params.sort === 'lift_date'}>
                  Lift date
                </SortableTh>
                <SortableTh {...sortProps} column="completed" active={params.sort === 'completed'}>
                  Completed
                </SortableTh>
                <TableHead className="w-20">Signed</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ plan, site, project, supervisor, signatureCount }) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-mono text-xs text-slate-600">
                    <Link href={`/lift-plans/${plan.id}`} className="font-medium text-slate-900 hover:underline">
                      {plan.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{project?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {supervisor?.displayName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums">
                    {new Date(plan.liftDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums">
                    {plan.completedAt ? (
                      <span className="text-emerald-700">
                        {new Date(plan.completedAt).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant={Number(signatureCount ?? 0) > 0 ? 'success' : 'secondary'}>
                      {Number(signatureCount ?? 0)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-slate-600">
                    {plan.description ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/lift-plans"
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

function DateRangeInputs({
  from,
  to,
  currentParams,
}: {
  from?: string
  to?: string
  currentParams: Record<string, string | string[] | undefined>
}) {
  // Pass-through all other params via hidden inputs so submitting the date
  // range doesn't wipe the active status / supervisor / search filters.
  const preserve = Object.entries(currentParams).flatMap(([k, v]) => {
    if (k === 'dateFrom' || k === 'dateTo' || k === 'page') return []
    if (Array.isArray(v)) return v.map((vv) => [k, vv] as const)
    if (typeof v === 'string') return [[k, v] as const]
    return []
  })
  return (
    <form className="flex items-center gap-2 text-xs">
      {preserve.map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <label className="flex items-center gap-1 text-slate-500">
        From
        <input
          type="date"
          name="dateFrom"
          defaultValue={from ?? ''}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </label>
      <label className="flex items-center gap-1 text-slate-500">
        To
        <input
          type="date"
          name="dateTo"
          defaultValue={to ?? ''}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </label>
      <Button size="sm" variant="outline" type="submit">
        Apply
      </Button>
    </form>
  )
}
