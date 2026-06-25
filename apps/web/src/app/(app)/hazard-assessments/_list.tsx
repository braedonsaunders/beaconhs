// Shared assessments list — powers both /hazard-assessments (everyone's) and
// /my/hazard-assessments (only the signed-in user's). One server component
// so the toolbar, KPI tiles, table, and pagination stay identical.

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
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
  hazidAssessmentHazards,
  hazidAssessmentTypes,
  hazidAssessments,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { HazidSubNav } from './_subnav'
import { RiskScoreChip } from './_risk'

const SORTS = ['reference', 'occurred_at', 'site', 'supervisor', 'type'] as const

export async function AssessmentsListPage({
  searchParams,
  basePath,
  mineOnly = false,
}: {
  searchParams: Record<string, string | string[] | undefined>
  basePath: '/hazard-assessments' | '/my/hazard-assessments'
  mineOnly?: boolean
}) {
  const sp = searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const typeFilter = pickString(sp.type)
  const statusFilter = pickString(sp.status) // 'open' | 'locked'
  const siteFilter = pickString(sp.site)
  const dateFromRaw = pickString(sp.dateFrom)
  const dateToRaw = pickString(sp.dateTo)

  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [sql`${hazidAssessments.deletedAt} is null`]
    if (mineOnly && ctx.membership?.id) {
      filters.push(eq(hazidAssessments.reportedByTenantUserId, ctx.membership.id))
    }
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
    if (siteFilter) filters.push(eq(hazidAssessments.siteOrgUnitId, siteFilter))
    if (dateFromRaw) filters.push(gte(hazidAssessments.occurredAt, new Date(dateFromRaw)))
    if (dateToRaw) filters.push(lte(hazidAssessments.occurredAt, new Date(`${dateToRaw}T23:59:59`)))
    const whereClause = and(...filters)

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
    const rows = await tx
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

    // Worst residual risk per visible assessment — residual falls back to the
    // pre-control rating when no post-control rating was captured.
    const pageIds = rows.map((r) => r.a.id)
    const worstRisk = new Map<string, number>()
    if (pageIds.length > 0) {
      const riskRows = await tx
        .select({
          assessmentId: hazidAssessmentHazards.assessmentId,
          worst: sql<number>`max(
            coalesce(${hazidAssessmentHazards.postLikelihood}, ${hazidAssessmentHazards.preLikelihood})
            * coalesce(${hazidAssessmentHazards.postSeverity}, ${hazidAssessmentHazards.preSeverity})
          )`,
        })
        .from(hazidAssessmentHazards)
        .where(
          and(
            inArray(hazidAssessmentHazards.assessmentId, pageIds),
            eq(hazidAssessmentHazards.applicable, true),
          ),
        )
        .groupBy(hazidAssessmentHazards.assessmentId)
      for (const r of riskRows) {
        if (r.worst != null) worstRisk.set(r.assessmentId, Number(r.worst))
      }
    }

    const allTypes = await tx
      .select({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })
      .from(hazidAssessmentTypes)
      .where(sql`${hazidAssessmentTypes.deletedAt} is null`)
      .orderBy(asc(hazidAssessmentTypes.name))

    const siteOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .innerJoin(hazidAssessments, eq(hazidAssessments.siteOrgUnitId, orgUnits.id))
      .groupBy(orgUnits.id, orgUnits.name)
      .orderBy(asc(orgUnits.name))

    return {
      rows,
      total: Number(tot?.c ?? 0),
      worstRisk,
      types: allTypes,
      sites: siteOptions,
    }
  })

  const { rows, total, worstRisk, types, sites } = data
  const sortProps = { basePath, currentParams: sp, dir: params.dir }
  const anyFilter = Boolean(params.q || typeFilter || statusFilter || siteFilter || dateFromRaw)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={mineOnly ? 'My hazard assessments' : 'Hazard assessments'}
            description={
              mineOnly
                ? 'Assessments you started — drafts to finish and records you own.'
                : 'Job hazard analyses and field risk assessments.'
            }
            actions={
              <Link href="/hazard-assessments/new">
                <Button>New assessment</Button>
              </Link>
            }
          />
          <HazidSubNav pathname={basePath} />
          <TableToolbar>
            <SearchInput placeholder="Search reference, scope, location…" />
            {/* Date range is a desk feature; phones get search + filter chips. */}
            <form className="hidden items-center gap-1 text-xs sm:flex">
              <label className="flex items-center gap-1 text-slate-500">
                From
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={dateFromRaw ?? ''}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500">
                to
                <input
                  type="date"
                  name="dateTo"
                  defaultValue={dateToRaw ?? ''}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                />
              </label>
              <button
                type="submit"
                className="h-8 rounded-md border border-slate-200 px-2 text-xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50"
              >
                Apply
              </button>
            </form>
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="type"
              label="Type"
              options={types.map((t) => ({ value: t.id, label: t.name }))}
            />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[
                { value: 'open', label: 'In progress' },
                { value: 'locked', label: 'Locked / complete' },
              ]}
            />
            {sites.length > 0 ? (
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="site"
                label="Site"
                options={sites.slice(0, 12).map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert size={32} />}
            title={anyFilter ? 'No assessments match these filters' : 'No assessments'}
            description="Capture the hazards for a planned task before crews start work."
            action={
              <Link href="/hazard-assessments/new">
                <Button>Start an assessment</Button>
              </Link>
            }
          />
        ) : (
          <>
            {/* Phones: tappable cards — the whole card opens the assessment. */}
            <ul className="space-y-2 sm:hidden">
              {rows.map(({ a, site, type }) => {
                const worst = worstRisk.get(a.id)
                return (
                  <li key={a.id}>
                    <Link
                      href={`/hazard-assessments/${a.id}`}
                      className="block rounded-lg border border-slate-200 bg-white p-3.5 active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                          {a.reference}
                        </span>
                        {a.locked ? (
                          <Badge variant="success">Locked</Badge>
                        ) : (
                          <Badge variant="secondary">In progress</Badge>
                        )}
                      </div>
                      <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {a.jobScope || type?.name || 'Hazard assessment'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(a.occurredAt).toLocaleDateString()}
                        {site ? ` · ${site.name}` : ''}
                        {type?.name && a.jobScope ? ` · ${type.name}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {worst != null ? <RiskScoreChip score={worst} /> : null}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>

            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="reference"
                      active={params.sort === 'reference'}
                    >
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
                    <TableHead>Residual risk</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ a, site, supervisor, type }) => {
                    const worst = worstRisk.get(a.id)
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                          <Link href={`/hazard-assessments/${a.id}`} className="hover:underline">
                            {a.reference}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {new Date(a.occurredAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {type?.name ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {site?.name ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/hazard-assessments/${a.id}`}
                            className="text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {a.jobScope ? (
                              a.jobScope.slice(0, 70) + (a.jobScope.length > 70 ? '…' : '')
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {worst != null ? (
                            <RiskScoreChip score={worst} />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {a.locked ? (
                            <Badge variant="success">Locked</Badge>
                          ) : (
                            <Badge variant="secondary">In progress</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath={basePath}
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}
      </div>
    </ListPageLayout>
  )
}
