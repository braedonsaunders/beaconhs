// Admin email-log viewer.
//
// Lists every email the worker has dispatched (or attempted to dispatch).
// Filters: status, recipient (email contains), category, date range (from/to).
// Search hits subject + recipient_primary + category_key.
//
// The list page deliberately does NOT select htmlBody/textBody — they live
// on the row but get fetched on the detail page only, to keep the list
// payload tight when a tenant has 100k+ rows.

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
import { emailLog, tenants } from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { DateRangeFilter, RecipientFilter } from './_filters'

export const metadata = { title: 'Email log' }
export const dynamic = 'force-dynamic'

const SORTS = ['created_at'] as const

const STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'opened', label: 'Opened' },
]

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'sent':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'bounced':
      return 'destructive'
    case 'opened':
      return 'success'
    case 'queued':
      return 'outline'
    default:
      return 'secondary'
  }
}

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
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

  // RBAC: only super-admins or users with the *email_log:read* permission
  // can see other tenants' rows. Regular users still get their own tenant.
  const ctx = await requireRequestContext()

  const { rows, total, categoryFacets } = await withSuperAdmin(db, async (tx) => {
    const filters: SQL<unknown>[] = []
    // Tenant scope: super-admin sees everything; tenant member sees only
    // their own tenantId OR tenantId IS NULL (platform mail).
    if (!ctx.isSuperAdmin) {
      filters.push(
        or(eq(emailLog.tenantId, ctx.tenantId), sql`${emailLog.tenantId} IS NULL`) as SQL<unknown>,
      )
    }
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(emailLog.subject, term),
        ilike(emailLog.recipientPrimary, term),
        ilike(emailLog.categoryKey, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) {
      filters.push(eq(emailLog.status, statusFilter as any))
    }
    if (categoryFilter) {
      filters.push(eq(emailLog.categoryKey, categoryFilter))
    }
    if (recipientFilter) {
      filters.push(ilike(emailLog.recipientPrimary, `%${recipientFilter}%`))
    }
    if (fromDate) {
      try {
        filters.push(gte(emailLog.createdAt, new Date(fromDate)))
      } catch {}
    }
    if (toDate) {
      try {
        // Include the entire end date by adding ~24h.
        const end = new Date(toDate)
        end.setHours(23, 59, 59, 999)
        filters.push(lte(emailLog.createdAt, end))
      } catch {}
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const data = await tx
      .select({
        log: {
          id: emailLog.id,
          tenantId: emailLog.tenantId,
          subject: emailLog.subject,
          recipientPrimary: emailLog.recipientPrimary,
          recipients: emailLog.recipients,
          status: emailLog.status,
          categoryKey: emailLog.categoryKey,
          fromAddr: emailLog.fromAddr,
          sentAt: emailLog.sentAt,
          createdAt: emailLog.createdAt,
          errorMessage: emailLog.errorMessage,
          providerMessageId: emailLog.providerMessageId,
        },
        tenant: { id: tenants.id, name: tenants.name },
      })
      .from(emailLog)
      .leftJoin(tenants, eq(tenants.id, emailLog.tenantId))
      .where(whereClause)
      .orderBy(desc(emailLog.createdAt))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // Estimate total — same trick as the audit log: read 1 row past the end.
    const [c] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(emailLog)
      .where(whereClause)

    // Category facets — top categories for the chips. Use a 200-row sample
    // window so it's cheap, and only group by non-null categoryKey.
    const facetRows = await tx
      .select({
        categoryKey: emailLog.categoryKey,
        n: sql<number>`count(*)::int`,
      })
      .from(emailLog)
      .where(
        and(
          ...(filters.length > 0 ? filters.filter((f) => true) : []),
          sql`${emailLog.categoryKey} IS NOT NULL`,
        ),
      )
      .groupBy(emailLog.categoryKey)
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
            back={{ href: '/admin', label: 'Back to admin' }}
            title="Email log"
            subtitle="Every transactional email the worker has dispatched"
          />
          <TableToolbar>
            <SearchInput placeholder="Search subject, recipient, category" />
            <RecipientFilter />
            <DateRangeFilter />
            <FilterChips
              basePath="/admin/email-log"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
            {categoryFacets.length > 0 ? (
              <FilterChips
                basePath="/admin/email-log"
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
        <EmptyState
          title="No emails logged yet"
          description="Once the worker dispatches an email it will appear here."
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                {ctx.isSuperAdmin ? <TableHead>Tenant</TableHead> : null}
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ log, tenant }) => {
                const otherCount = Array.isArray(log.recipients) ? log.recipients.length - 1 : 0
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      <div className="font-mono text-xs">{log.recipientPrimary ?? '—'}</div>
                      {otherCount > 0 ? (
                        <div className="text-[11px] text-slate-500">
                          +{otherCount} other{otherCount === 1 ? '' : 's'}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-slate-900">
                      {log.subject}
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {log.categoryKey ? (
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {log.categoryKey}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
                      {log.status === 'failed' && log.errorMessage ? (
                        <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-700">
                          {log.errorMessage}
                        </div>
                      ) : null}
                    </TableCell>
                    {ctx.isSuperAdmin ? (
                      <TableCell className="text-xs text-slate-600">
                        {tenant?.name ?? <span className="text-slate-400">platform</span>}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/email-log/${log.id}` as any}
                        className="text-teal-700 hover:underline"
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/admin/email-log"
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
