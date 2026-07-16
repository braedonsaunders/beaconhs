import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// Shared assessments list — powers both /hazard-assessments (everyone's) and
// /my/hazard-assessments (only the signed-in user's). One server component
// so the toolbar, KPI tiles, table, and pagination stay identical.

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
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
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
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
  UrlDrawer,
} from '@beaconhs/ui'
import { htmlToSnippet } from '@beaconhs/forms-core'
import {
  formTemplates,
  hazidAssessmentHazards,
  hazidAssessmentTypeApps,
  hazidAssessmentTypes,
  hazidAssessments,
  orgUnits,
  people,
  personGroupMemberships,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { HazidSubNav } from './_subnav'
import { formatDate, parseDatetimeLocal } from '@/lib/datetime'
import { RiskScoreChip } from './_risk'
import { NewAssessmentDrawer, type NewAssessmentType } from './_new-drawer'
import { startAssessment } from './_actions'
import {
  loadHazardAssessmentSiteOptions,
  loadMyHazardAssessmentSiteOptions,
} from './_site-picker-actions'

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const typeParam = pickString(sp.type)
  const typeFilter = typeParam && isUuid(typeParam) ? typeParam : undefined
  const statusParam = pickString(sp.status)
  const statusFilter = statusParam === 'open' || statusParam === 'locked' ? statusParam : undefined
  const reviewParam = pickString(sp.review)
  const reviewFilter =
    reviewParam === 'pending' || reviewParam === 'approved' || reviewParam === 'rejected'
      ? reviewParam
      : undefined
  const siteParam = pickString(sp.site)
  const siteFilter = siteParam && isUuid(siteParam) ? siteParam : undefined
  const dateFromRaw = pickString(sp.dateFrom)
  const dateToRaw = pickString(sp.dateTo)
  const drawerKey = pickString(sp.drawer)

  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    // Per-user record visibility: read.all → everything, read.site → my sites,
    // else → assessments I reported. Composes with the `mineOnly` "my" page flag.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'hazid',
      ownerCols: [hazidAssessments.reportedByTenantUserId],
      siteCol: hazidAssessments.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [sql`${hazidAssessments.deletedAt} is null`]
    if (vis) filters.push(vis)
    if (mineOnly) {
      filters.push(
        ctx.membership?.id
          ? eq(hazidAssessments.reportedByTenantUserId, ctx.membership.id)
          : sql`false`,
      )
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
    if (reviewFilter) filters.push(eq(hazidAssessments.reviewStatus, reviewFilter))
    if (siteFilter) filters.push(eq(hazidAssessments.siteOrgUnitId, siteFilter))
    // Both range bounds are wall-clock dates in the user's timezone — parse
    // them the same way so From and To never straddle different zones.
    const dateFrom = dateFromRaw ? parseDatetimeLocal(`${dateFromRaw}T00:00`, ctx.timezone) : null
    const dateTo = dateToRaw ? parseDatetimeLocal(`${dateToRaw}T23:59:59.999`, ctx.timezone) : null
    if (dateFrom) filters.push(gte(hazidAssessments.occurredAt, dateFrom))
    if (dateTo) filters.push(lte(hazidAssessments.occurredAt, dateTo))
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

    return {
      rows,
      total: Number(tot?.c ?? 0),
      worstRisk,
      types: allTypes,
    }
  })

  const { rows, total, worstRisk, types } = data
  const sortProps = { basePath, currentParams: sp, dir: params.dir }
  const anyFilter = Boolean(
    params.q || typeFilter || statusFilter || reviewFilter || siteFilter || dateFromRaw,
  )

  // Type cards for the "Start a hazard assessment" flyout — only loaded while
  // it's open. Mirrors the legacy /new group-availability filter: a type with
  // group restrictions is only offered to members of those groups.
  const newTypes: NewAssessmentType[] =
    drawerKey === 'new'
      ? await ctx.db(async (tx) => {
          const allTypes = await tx
            .select()
            .from(hazidAssessmentTypes)
            .where(isNull(hazidAssessmentTypes.deletedAt))
            .orderBy(asc(hazidAssessmentTypes.name))
          const restricted = allTypes.some((t) => (t.availableToGroupIds ?? []).length > 0)
          const attachedApps =
            allTypes.length > 0
              ? await tx
                  .select({
                    typeId: hazidAssessmentTypeApps.typeId,
                    label: hazidAssessmentTypeApps.label,
                    templateName: formTemplates.name,
                  })
                  .from(hazidAssessmentTypeApps)
                  .innerJoin(
                    formTemplates,
                    eq(formTemplates.id, hazidAssessmentTypeApps.templateId),
                  )
                  .where(
                    and(
                      inArray(
                        hazidAssessmentTypeApps.typeId,
                        allTypes.map((type) => type.id),
                      ),
                      isNull(hazidAssessmentTypeApps.deletedAt),
                    ),
                  )
                  .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
              : []
          let myGroupIds = new Set<string>()
          if (restricted && !ctx.isSuperAdmin) {
            const [me] = await tx
              .select({ id: people.id })
              .from(people)
              .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
              .limit(1)
            if (me) {
              const memberships = await tx
                .select({ groupId: personGroupMemberships.groupId })
                .from(personGroupMemberships)
                .where(eq(personGroupMemberships.personId, me.id))
              myGroupIds = new Set(memberships.map((m) => m.groupId))
            }
          }
          return allTypes
            .filter((t) => {
              const allow = t.availableToGroupIds ?? []
              if (allow.length === 0) return true
              if (ctx.isSuperAdmin) return true
              return allow.some((g) => myGroupIds.has(g))
            })
            .map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              style: t.style,
              hasPPE: t.hasPPE,
              hasQuestions: t.hasQuestions,
              builderApps: attachedApps
                .filter((app) => app.typeId === t.id)
                .map((app) => app.label || app.templateName),
            }))
        })
      : []

  return (
    <>
      <ListPageLayout
        header={
          <>
            <PageHeader
              back={mineOnly ? { href: '/my', label: 'Workspace' } : undefined}
              title={tGeneratedValue(
                mineOnly ? tGenerated('m_0dec5f2c651118') : tGenerated('m_12db47b4ac8e02'),
              )}
              description={tGeneratedValue(
                mineOnly ? tGenerated('m_180efb0cc3e9dc') : tGenerated('m_063d5ef44c90a6'),
              )}
              actions={
                <Link href={`${basePath}?drawer=new`} scroll={false}>
                  <Button>
                    <GeneratedText id="m_0b765ce4236ed0" />
                  </Button>
                </Link>
              }
            />
            <HazidSubNav pathname={basePath} />
            <TableToolbar>
              <SearchInput placeholder={tGenerated('m_1264d3630df305')} />
              {/* Date range is a desk feature; phones get search + filter chips. */}
              <form className="hidden items-center gap-1 text-xs sm:flex">
                <GeneratedValue
                  value={Object.entries({
                    q: params.q,
                    type: typeFilter,
                    status: statusFilter,
                    review: reviewFilter,
                    site: siteFilter,
                    sort: params.sort !== 'occurred_at' ? params.sort : undefined,
                    dir: params.dir !== 'desc' ? params.dir : undefined,
                  })
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <input key={key} type="hidden" name={key} value={String(value)} />
                    ))}
                />
                <label className="flex items-center gap-1 text-slate-500">
                  <GeneratedText id="m_154c9d7a784dda" />
                  <input
                    type="date"
                    name="dateFrom"
                    defaultValue={dateFromRaw ?? ''}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  <GeneratedText id="m_02d4f83ff8f11c" />
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
                  <GeneratedText id="m_01185cdc1c20a5" />
                </button>
              </form>
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="type"
                label={tGenerated('m_074ba2f160c506')}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
              />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="review"
                label={tGenerated('m_039fc01243fb46')}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' },
                ]}
              />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="status"
                label={tGenerated('m_0b9da892d6faf0')}
                options={[
                  { value: 'open', label: 'In progress' },
                  { value: 'locked', label: 'Locked / complete' },
                ]}
              />
              <RemoteSearchFilter
                loadOptions={
                  mineOnly ? loadMyHazardAssessmentSiteOptions : loadHazardAssessmentSiteOptions
                }
                basePath={basePath}
                currentParams={sp}
                paramKey="site"
                placeholder={tGenerated('m_1f5ad6ec6b5d2a')}
                allLabel="All sites"
                searchPlaceholder={tGenerated('m_008b0b4bd263a4')}
                ariaLabel="Filter hazard assessments by site"
              />
            </TableToolbar>
          </>
        }
      >
        <div className="space-y-4 sm:space-y-5">
          <GeneratedValue
            value={
              rows.length === 0 ? (
                <EmptyState
                  icon={<ShieldAlert size={32} />}
                  title={tGeneratedValue(
                    anyFilter ? tGenerated('m_1774cc3000b3a2') : tGenerated('m_0caef616765e46'),
                  )}
                  description={tGenerated('m_0c4898dcfdd36c')}
                  action={
                    <Link href={`${basePath}?drawer=new`} scroll={false}>
                      <Button>
                        <GeneratedText id="m_039ccc682982ec" />
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <>
                  {/* Phones: tappable cards — the whole card opens the assessment. */}
                  <ul className="space-y-2 sm:hidden">
                    <GeneratedValue
                      value={rows.map(({ a, site, type }) => {
                        const worst = worstRisk.get(a.id)
                        const scope = htmlToSnippet(a.jobScope, 120)
                        return (
                          <li key={a.id}>
                            <Link
                              href={`/hazard-assessments/${a.id}`}
                              className="block rounded-lg border border-slate-200 bg-white p-3.5 active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                                  <GeneratedValue value={a.reference} />
                                </span>
                                <GeneratedValue
                                  value={
                                    a.locked ? (
                                      <Badge variant="success">
                                        <GeneratedText id="m_0e259fa0babc2d" />
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary">
                                        <GeneratedText id="m_1a03b06872ffd9" />
                                      </Badge>
                                    )
                                  }
                                />
                              </div>
                              <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                                <GeneratedValue
                                  value={
                                    scope || type?.name || <GeneratedText id="m_171ca9d60eef14" />
                                  }
                                />
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                <GeneratedValue
                                  value={formatDate(a.occurredAt, ctx.timezone, ctx.locale)}
                                />
                                <GeneratedValue value={site ? ` · ${site.name}` : ''} />
                                <GeneratedValue
                                  value={type?.name && scope ? ` · ${type.name}` : ''}
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <GeneratedValue
                                  value={worst != null ? <RiskScoreChip score={worst} /> : null}
                                />
                                <Badge
                                  variant={
                                    a.reviewStatus === 'approved'
                                      ? 'success'
                                      : a.reviewStatus === 'rejected'
                                        ? 'destructive'
                                        : 'outline'
                                  }
                                >
                                  <GeneratedText id="m_0419fd6343482d" />{' '}
                                  <GeneratedValue value={a.reviewStatus} />
                                </Badge>
                              </div>
                            </Link>
                          </li>
                        )
                      })}
                    />
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
                            <GeneratedText id="m_036b564bb88dfe" />
                          </SortableTh>
                          <SortableTh
                            {...sortProps}
                            column="occurred_at"
                            active={params.sort === 'occurred_at'}
                          >
                            <GeneratedText id="m_0285c38761c540" />
                          </SortableTh>
                          <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                            <GeneratedText id="m_074ba2f160c506" />
                          </SortableTh>
                          <SortableTh {...sortProps} column="site" active={params.sort === 'site'}>
                            <GeneratedText id="m_020146dd3d3d5a" />
                          </SortableTh>
                          <SortableTh
                            {...sortProps}
                            column="supervisor"
                            active={params.sort === 'supervisor'}
                          >
                            <GeneratedText id="m_0ccb8e5b917b17" />
                          </SortableTh>
                          <TableHead>
                            <GeneratedText id="m_1f10a46fc1db73" />
                          </TableHead>
                          <TableHead>
                            <GeneratedText id="m_07b859db8c7ce8" />
                          </TableHead>
                          <TableHead>
                            <GeneratedText id="m_0b9da892d6faf0" />
                          </TableHead>
                          <TableHead>
                            <GeneratedText id="m_039fc01243fb46" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <GeneratedValue
                          value={rows.map(({ a, site, supervisor, type }) => {
                            const worst = worstRisk.get(a.id)
                            const scope = htmlToSnippet(a.jobScope, 70)
                            return (
                              <TableRow key={a.id}>
                                <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                                  <Link
                                    href={`/hazard-assessments/${a.id}`}
                                    className="hover:underline"
                                  >
                                    <GeneratedValue value={a.reference} />
                                  </Link>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                                  <GeneratedValue
                                    value={formatDate(a.occurredAt, ctx.timezone, ctx.locale)}
                                  />
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400">
                                  <GeneratedValue value={type?.name ?? '—'} />
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400">
                                  <GeneratedValue value={site?.name ?? '—'} />
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400">
                                  <GeneratedValue
                                    value={
                                      supervisor
                                        ? `${supervisor.firstName} ${supervisor.lastName}`
                                        : '—'
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Link
                                    href={`/hazard-assessments/${a.id}`}
                                    className="text-slate-900 hover:underline dark:text-slate-100"
                                  >
                                    <GeneratedValue
                                      value={
                                        scope ? scope : <span className="text-slate-400">—</span>
                                      }
                                    />
                                  </Link>
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      worst != null ? (
                                        <RiskScoreChip score={worst} />
                                      ) : (
                                        <span className="text-xs text-slate-400">—</span>
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      a.locked ? (
                                        <Badge variant="success">
                                          <GeneratedText id="m_0e259fa0babc2d" />
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary">
                                          <GeneratedText id="m_1a03b06872ffd9" />
                                        </Badge>
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      a.reviewStatus === 'approved'
                                        ? 'success'
                                        : a.reviewStatus === 'rejected'
                                          ? 'destructive'
                                          : 'outline'
                                    }
                                  >
                                    <GeneratedValue value={a.reviewStatus} />
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        />
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
              )
            }
          />
        </div>
      </ListPageLayout>

      <UrlDrawer
        open={drawerKey === 'new'}
        closeHref={basePath}
        title={tGenerated('m_09ea1faa2a45cf')}
        description={tGenerated('m_15452a730a15cb')}
        size="md"
      >
        <NewAssessmentDrawer types={newTypes} startAction={startAssessment} />
      </UrlDrawer>
    </>
  )
}
