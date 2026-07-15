import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, users as user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'
import { RecordsTable, type RecordsTableRow } from './_records-table'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1eca9264eb7c3a') }
}

const SORTS = [
  'reference',
  'title',
  'severity',
  'status',
  'due_on',
  'assigned_on',
  'created_at',
  'owner',
  'site',
] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export default async function CorrectiveActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'created_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default the list to open actions; an explicit `status=all` (the "All
  // statuses" chip) clears the default so every status shows.
  const statusRaw = pickString(sp.status) ?? 'open'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const sevFilter = pickString(sp.severity)
  const ctx = await requireRequestContext()
  // The export route accepts any read tier — mirror that here so read.all /
  // read.site-only roles still see the button.
  const canExport =
    can(ctx, 'admin.data.export') &&
    (can(ctx, 'ca.read.all') || can(ctx, 'ca.read.site') || can(ctx, 'ca.read.self'))
  const canUpdate = can(ctx, 'ca.update')

  const { rows, total, statusCounts, sevCounts } = await ctx.db(async (tx) => {
    // Per-user record visibility: read.all → everything, read.site → my sites,
    // else → corrective actions I own.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [isNull(correctiveActions.deletedAt)]
    if (vis) filters.push(vis)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(correctiveActions.reference, term),
        ilike(correctiveActions.title, term),
        ilike(correctiveActions.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(correctiveActions.status, statusFilter as any))
    if (sevFilter) filters.push(eq(correctiveActions.severity, sevFilter as any))
    const whereClause = and(...filters)

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'reference'
        ? [dirFn(correctiveActions.reference)]
        : params.sort === 'title'
          ? [dirFn(correctiveActions.title)]
          : params.sort === 'severity'
            ? [dirFn(correctiveActions.severity)]
            : params.sort === 'status'
              ? [dirFn(correctiveActions.status)]
              : params.sort === 'due_on'
                ? [dirFn(correctiveActions.dueOn)]
                : params.sort === 'assigned_on'
                  ? [dirFn(correctiveActions.assignedOn)]
                  : params.sort === 'owner'
                    ? [dirFn(sql`coalesce(${user.name}, ${tenantUsers.displayName})`)]
                    : params.sort === 'site'
                      ? [dirFn(orgUnits.name)]
                      : [dirFn(correctiveActions.createdAt)]

    const [tot] = await tx.select({ c: count() }).from(correctiveActions).where(whereClause)
    const data = await tx
      .select({
        ca: correctiveActions,
        site: orgUnits,
        owner: tenantUsers,
        ownerAccount: user,
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const facetWhere = and(isNull(correctiveActions.deletedAt), vis)
    const ss = await tx
      .select({ s: correctiveActions.status, c: count() })
      .from(correctiveActions)
      .where(facetWhere)
      .groupBy(correctiveActions.status)
    const sv = await tx
      .select({ s: correctiveActions.severity, c: count() })
      .from(correctiveActions)
      .where(facetWhere)
      .groupBy(correctiveActions.severity)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      sevCounts: Object.fromEntries(sv.map((x) => [x.s, Number(x.c)])),
    }
  })

  const today = new Date().toISOString().slice(0, 10)

  const tableRows: RecordsTableRow[] = rows.map(({ ca, site, owner, ownerAccount }) => ({
    id: ca.id,
    reference: ca.reference,
    title: ca.title,
    severity: ca.severity,
    status: ca.status,
    dueOn: ca.dueOn,
    createdAt: new Date(ca.createdAt).toISOString().slice(0, 10),
    siteName: site?.name ?? null,
    ownerName: ownerAccount?.name ?? owner?.displayName ?? null,
    locked: ca.locked,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1eca9264eb7c3a')}
            description={tGenerated('m_1fd2750d15b2ba')}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <a
                        href={buildExportHref('/corrective-actions/export.csv', {
                          ...sp,
                          status: statusRaw,
                        })}
                      >
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </a>
                    ) : null
                  }
                />
                <Link href="/corrective-actions/new">
                  <Button>
                    <GeneratedText id="m_1c4ac986e95578" />
                  </Button>
                </Link>
              </div>
            }
          />
          <CorrectiveActionsSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1ae990361ad66e')} />
            <FilterChips
              basePath="/corrective-actions"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              allLabel="All statuses"
              defaultValue="open"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/corrective-actions"
              currentParams={sp}
              paramKey="severity"
              label={tGenerated('m_168b365cc671bf')}
              options={SEVERITY_OPTIONS.map((o) => ({ ...o, count: sevCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          tableRows.length === 0 ? (
            <EmptyState
              icon={<ListChecks size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter || sevFilter
                  ? tGenerated('m_003b25bf1c2c70')
                  : tGenerated('m_065564e61d1905'),
              )}
              description={tGenerated('m_0eb933f79ad4ca')}
              action={
                <Link href="/corrective-actions/new">
                  <Button>
                    <GeneratedText id="m_16b0371ad9cc2c" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <RecordsTable
                rows={tableRows}
                today={today}
                canUpdate={canUpdate}
                basePath="/corrective-actions"
                currentParams={sp}
                sort={params.sort}
                dir={params.dir}
              />
              <Pagination
                basePath="/corrective-actions"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
