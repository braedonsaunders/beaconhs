import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { auditLog, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

const SORTS = ['occurred_at'] as const

const ACTION_OPTIONS = [
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'publish', label: 'Publish' },
  { value: 'sign', label: 'Sign' },
]

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'occurred_at', dir: 'desc', perPage: 50, allowedSorts: SORTS })
  const actionFilter = pickString(sp.action)
  const entityFilter = pickString(sp.entityType)
  const ctx = await requireRequestContext()

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(auditLog.entityType, term), ilike(auditLog.summary, term))
      if (cond) filters.push(cond)
    }
    if (actionFilter) filters.push(eq(auditLog.action, actionFilter))
    if (entityFilter) filters.push(eq(auditLog.entityType, entityFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const data = await tx
      .select({ log: auditLog, actor: user })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(whereClause)
      .orderBy(desc(auditLog.occurredAt))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const [c] = await tx.select({ c: auditLog.id }).from(auditLog).where(whereClause).limit(1)
    // crude total estimator: just return rows length for now if pagination would be misleading
    return { rows: data, total: data.length + (data.length === params.perPage ? params.perPage : 0) }
  })

  return (
    <PageContainer>
      <div className="space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Audit log"
          subtitle="Every write to a tenant-scoped record"
        />
        <div className="flex items-center gap-3">
          <SearchInput placeholder="Search entity type or summary" />
        </div>
        <FilterChips
          basePath="/admin/audit"
          currentParams={sp}
          paramKey="action"
          label="Action"
          options={ACTION_OPTIONS}
        />
        {rows.length === 0 ? (
          <EmptyState title="No audit entries yet" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ log, actor }) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-slate-600">
                      {new Date(log.occurredAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-slate-700">{actor?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{log.action}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {log.entityType}
                      {log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell className="text-slate-900">{log.summary ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              basePath="/admin/audit"
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}
      </div>
    </PageContainer>
  )
}
