import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, users as user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_112ed207438629') }
}
export const dynamic = 'force-dynamic'

const BASE = '/corrective-actions/reports/aging'
const SORTS = ['age', 'reference', 'title', 'severity', 'status', 'owner', 'site'] as const

type Bucket = '<7d' | '7-30d' | '30-60d' | '60+d'

const BUCKETS: { key: Bucket; label: string; tone: string; help: string }[] = [
  {
    key: '<7d',
    label: '< 7 days',
    tone: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
    help: 'Fresh',
  },
  {
    key: '7-30d',
    label: '7–30 days',
    tone: 'bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200',
    help: 'Warming up',
  },
  {
    key: '30-60d',
    label: '30–60 days',
    tone: 'bg-orange-100 dark:bg-orange-500/15 text-orange-900 dark:text-orange-200',
    help: 'Getting stale',
  },
  {
    key: '60+d',
    label: '60+ days',
    tone: 'bg-red-100 dark:bg-red-500/15 text-red-900 dark:text-red-200',
    help: 'Hot potato',
  },
]

type Row = {
  id: string
  reference: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
  ageDays: number
  bucket: Bucket
  ownerName: string | null
  siteName: string | null
  dueOn: string | null
  assignedOn: string | null
}

function bucketForAge(days: number): Bucket {
  if (days < 7) return '<7d'
  if (days < 30) return '7-30d'
  if (days < 60) return '30-60d'
  return '60+d'
}

/**
 * Aging report — open CAs bucketed by how long they've been on the books
 * (today − assignedOn, falling back to today − createdAt). Header tiles
 * show the counts per bucket; the table is grouped per bucket so the
 * "60+ days" stuff is front-and-centre.
 */
export default async function AgingReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'age',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const bucketParam = pickString(sp.bucket)
  const bucketFilter = BUCKETS.find((bucket) => bucket.key === bucketParam)?.key
  const severityParam = pickString(sp.severity)
  const severityFilter = ['low', 'medium', 'high', 'critical'].find(
    (severity) => severity === severityParam,
  ) as Row['severity'] | undefined
  const statusParam = pickString(sp.status)
  const statusFilter = ['open', 'in_progress', 'pending_verification'].find(
    (status) => status === statusParam,
  ) as Row['status'] | undefined
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await ctx.db(async (tx) => {
    // Per-user record visibility — same predicate as the /corrective-actions
    // list page, so a self/site-tier user only sees their slice here too.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    return tx
      .select({
        ca: correctiveActions,
        owner: tenantUsers,
        ownerAccount: user,
        site: orgUnits,
      })
      .from(correctiveActions)
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(
        and(
          isNull(correctiveActions.deletedAt),
          inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
          vis,
        ),
      )
      .orderBy(asc(correctiveActions.assignedOn))
  })

  const enriched: Row[] = rows.map((r) => {
    const baseline = r.ca.assignedOn
      ? Date.parse(r.ca.assignedOn)
      : r.ca.createdAt
        ? new Date(r.ca.createdAt).getTime()
        : Date.parse(today)
    const ageDays = Math.max(0, Math.round((Date.parse(today) - baseline) / 86_400_000))
    return {
      id: r.ca.id,
      reference: r.ca.reference,
      title: r.ca.title,
      severity: r.ca.severity,
      status: r.ca.status,
      ageDays,
      bucket: bucketForAge(ageDays),
      ownerName: r.ownerAccount?.name ?? r.owner?.displayName ?? null,
      siteName: r.site?.name ?? null,
      dueOn: r.ca.dueOn,
      assignedOn: r.ca.assignedOn,
    }
  })

  const counts: Record<Bucket, number> = { '<7d': 0, '7-30d': 0, '30-60d': 0, '60+d': 0 }
  for (const r of enriched) counts[r.bucket]++
  const query = params.q?.toLowerCase()
  const filtered = enriched.filter((row) => {
    if (bucketFilter && row.bucket !== bucketFilter) return false
    if (severityFilter && row.severity !== severityFilter) return false
    if (statusFilter && row.status !== statusFilter) return false
    if (!query) return true
    return [
      row.reference,
      row.title,
      row.severity,
      row.status,
      row.ownerName ?? '',
      row.siteName ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
  const severityRank: Record<Row['severity'], number> = { low: 0, medium: 1, high: 2, critical: 3 }
  const mult = params.dir === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const comparison =
      params.sort === 'reference'
        ? a.reference.localeCompare(b.reference)
        : params.sort === 'title'
          ? a.title.localeCompare(b.title)
          : params.sort === 'severity'
            ? severityRank[a.severity] - severityRank[b.severity]
            : params.sort === 'status'
              ? a.status.localeCompare(b.status)
              : params.sort === 'owner'
                ? (a.ownerName ?? '').localeCompare(b.ownerName ?? '')
                : params.sort === 'site'
                  ? (a.siteName ?? '').localeCompare(b.siteName ?? '')
                  : a.ageDays - b.ageDays
    return comparison * mult || b.ageDays - a.ageDays
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / params.perPage))
  const page = Math.min(params.page, pageCount)
  const pageRows = filtered.slice((page - 1) * params.perPage, page * params.perPage)

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="aging" />
          <PageHeader
            title={tGenerated('m_112ed207438629')}
            description={tGenerated('m_04061670db1e74')}
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GeneratedValue
              value={BUCKETS.map((b) => (
                <div
                  key={b.key}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      <GeneratedValue value={b.label} />
                    </span>
                    <Badge className={b.tone} variant="default">
                      <GeneratedValue value={counts[b.key]} />
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={b.help} />
                  </div>
                </div>
              ))}
            />
          </div>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_049dd9970ac051')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="bucket"
              label={tGenerated('m_1fe7464d2a4724')}
              options={BUCKETS.map((bucket) => ({
                value: bucket.key,
                label: bucket.label,
                count: counts[bucket.key],
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="severity"
              label={tGenerated('m_168b365cc671bf')}
              options={['low', 'medium', 'high', 'critical'].map((severity) => ({
                value: severity,
                label: severity,
                count: enriched.filter((row) => row.severity === severity).length,
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={['open', 'in_progress', 'pending_verification'].map((status) => ({
                value: status,
                label: status.replace('_', ' '),
                count: enriched.filter((row) => row.status === status).length,
              }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          pageRows.length === 0 ? (
            <EmptyState
              icon={<Hourglass size={32} />}
              title={tGeneratedValue(
                enriched.length === 0
                  ? tGenerated('m_01baf77931cc70')
                  : tGenerated('m_0e5996cbd0fb25'),
              )}
              description={tGeneratedValue(
                enriched.length === 0
                  ? tGenerated('m_18c1c50577773e')
                  : tGenerated('m_0c29363c482f01'),
              )}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-2">
                      <GeneratedText id="m_1e4d8e61e66a27" />
                    </th>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="reference"
                    >
                      <GeneratedText id="m_036b564bb88dfe" />
                    </SortTh>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="title"
                    >
                      <GeneratedText id="m_0decefd558c355" />
                    </SortTh>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="severity"
                    >
                      <GeneratedText id="m_168b365cc671bf" />
                    </SortTh>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="status"
                    >
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortTh>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="owner"
                    >
                      <GeneratedText id="m_09e0cae12d3f44" />
                    </SortTh>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="site"
                    >
                      <GeneratedText id="m_020146dd3d3d5a" />
                    </SortTh>
                    <th className="px-4 py-2">
                      <GeneratedText id="m_1f0e0a43fee444" />
                    </th>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="age"
                      align="right"
                      className="text-right"
                    >
                      <GeneratedText id="m_021e7347240d37" />
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <GeneratedValue
                    value={pageRows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                        <td className="px-4 py-2">
                          <Badge
                            className={BUCKETS.find((bucket) => bucket.key === r.bucket)?.tone}
                            variant="default"
                          >
                            <GeneratedValue
                              value={BUCKETS.find((bucket) => bucket.key === r.bucket)?.label}
                            />
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link
                            href={`/corrective-actions/${r.id}` as any}
                            className="hover:underline"
                          >
                            <GeneratedValue value={r.reference} />
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/corrective-actions/${r.id}` as any}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={r.title} />
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={
                              r.severity === 'critical' || r.severity === 'high'
                                ? 'destructive'
                                : r.severity === 'medium'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            <GeneratedValue value={r.severity} />
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="warning">
                            <GeneratedValue value={r.status.replace('_', ' ')} />
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={r.ownerName ?? '—'} />
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={r.siteName ?? '—'} />
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={r.assignedOn ?? '—'} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={r.ageDays} />
                        </td>
                      </tr>
                    ))}
                  />
                </tbody>
              </table>
            </div>
          )
        }
      />
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={filtered.length}
        page={page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
