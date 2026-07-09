// Shared SMS-log list — rendered at two routes:
//   • /admin/sms-log    (scope: 'tenant')   — only the active tenant's texts.
//   • /platform/sms-log (scope: 'platform') — every tenant's texts (the
//     platform layout already gates this to super-admins).
//
// The list does NOT select the full body — it is fetched on the detail page
// only, to keep the list payload tight. Mirrors the email-log list.

import Link from 'next/link'
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { smsLog, tenants } from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { DateRangeFilter, TextParamFilter } from '@/components/log-filters'

export type SmsLogScope = 'tenant' | 'platform'

const SORTS = ['created_at'] as const

const STATUS_OPTIONS = [
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'skipped', label: 'Skipped' },
]

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'sent':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'suppressed':
      return 'warning'
    case 'skipped':
      return 'outline'
    default:
      return 'secondary'
  }
}

export async function SmsLogListView({
  searchParams: sp,
  scope,
  basePath,
  back,
}: {
  searchParams: Record<string, string | string[] | undefined>
  scope: SmsLogScope
  basePath: string
  back: { href: string; label: string }
}) {
  const params = parseListParams(sp, {
    sort: 'created_at',
    dir: 'desc',
    perPage: 50,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const categoryFilter = pickString(sp.category)
  const recipientFilter = pickString(sp.recipient)?.trim() ?? ''
  const fromDate = pickString(sp.from)?.trim() ?? ''
  const toDate = pickString(sp.to)?.trim() ?? ''

  const ctx = await requireRequestContext()
  const showTenant = scope === 'platform'

  const { rows, total, categoryFacets } = await withSuperAdmin(db, async (tx) => {
    const filters: SQL<unknown>[] = []
    // Tenant scope: the admin view is pinned to the active tenant (plus any
    // platform-level rows with a null tenantId); the platform view spans every
    // tenant. The platform layout already restricts that route to super-admins.
    if (scope === 'tenant') {
      filters.push(
        or(eq(smsLog.tenantId, ctx.tenantId), sql`${smsLog.tenantId} IS NULL`) as SQL<unknown>,
      )
    }
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(smsLog.recipient, term),
        ilike(smsLog.body, term),
        ilike(smsLog.categoryKey, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) {
      filters.push(eq(smsLog.status, statusFilter as never))
    }
    if (categoryFilter) {
      filters.push(eq(smsLog.categoryKey, categoryFilter))
    }
    if (recipientFilter) {
      filters.push(ilike(smsLog.recipient, `%${recipientFilter}%`))
    }
    // Ignore malformed date params — new Date('garbage') doesn't throw, it
    // returns an Invalid Date that blows up during query serialization.
    if (fromDate) {
      const start = new Date(fromDate)
      if (!Number.isNaN(start.getTime())) filters.push(gte(smsLog.createdAt, start))
    }
    if (toDate) {
      const end = new Date(toDate)
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999)
        filters.push(lte(smsLog.createdAt, end))
      }
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const data = await tx
      .select({
        log: {
          id: smsLog.id,
          tenantId: smsLog.tenantId,
          recipient: smsLog.recipient,
          body: smsLog.body,
          status: smsLog.status,
          provider: smsLog.provider,
          categoryKey: smsLog.categoryKey,
          sentAt: smsLog.sentAt,
          createdAt: smsLog.createdAt,
          errorMessage: smsLog.errorMessage,
          providerMessageId: smsLog.providerMessageId,
        },
        tenant: { id: tenants.id, name: tenants.name },
      })
      .from(smsLog)
      .leftJoin(tenants, eq(tenants.id, smsLog.tenantId))
      .where(whereClause)
      .orderBy(desc(smsLog.createdAt))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const [c] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(smsLog)
      .where(whereClause)

    const facetRows = await tx
      .select({
        categoryKey: smsLog.categoryKey,
        n: sql<number>`count(*)::int`,
      })
      .from(smsLog)
      .where(and(...filters, sql`${smsLog.categoryKey} IS NOT NULL`))
      .groupBy(smsLog.categoryKey)
      .orderBy(sql`count(*) desc`)
      .limit(10)

    return {
      rows: data,
      total: Number(c?.c ?? 0),
      categoryFacets: facetRows
        .filter((r) => !!r.categoryKey)
        .map((r) => ({
          value: r.categoryKey as string,
          label: r.categoryKey as string,
          count: r.n,
        })),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <DetailHeader
            back={back}
            title="SMS log"
            subtitle={
              scope === 'platform'
                ? 'Every text message the worker has dispatched, across all tenants'
                : 'Every text message the worker has dispatched for this tenant'
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search number, message, category" />
            <TextParamFilter
              paramKey="recipient"
              label="Recipient"
              type="tel"
              placeholder="+15551234567"
              className="h-8 w-48"
            />
            <DateRangeFilter />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
            {categoryFacets.length > 0 ? (
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="category"
                label="Category"
                options={categoryFacets}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No texts logged" description="Sent SMS messages appear here." />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                {showTenant ? <TableHead>Tenant</TableHead> : null}
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ log, tenant }) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {formatDateTime(new Date(log.createdAt), ctx.timezone)}
                  </TableCell>
                  <TableCell className="text-slate-900 dark:text-slate-100">
                    <div className="font-mono text-xs">{log.recipient ?? '—'}</div>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-slate-700 dark:text-slate-300">
                    {log.body ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {log.categoryKey ? (
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {log.categoryKey}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
                      {log.provider && log.status === 'sent' ? (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          via {log.provider}
                        </span>
                      ) : null}
                    </div>
                    {log.status === 'failed' && log.errorMessage ? (
                      <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-700 dark:text-red-400">
                        {log.errorMessage}
                      </div>
                    ) : null}
                  </TableCell>
                  {showTenant ? (
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                      {tenant?.name ?? <span className="text-slate-400">platform</span>}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Link
                      href={`${basePath}/${log.id}` as never}
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath={basePath}
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </div>
      )}
    </ListPageLayout>
  )
}
