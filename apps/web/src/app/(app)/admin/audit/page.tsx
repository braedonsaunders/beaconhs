import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { PageContainer } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'

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
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 50,
    allowedSorts: SORTS,
  })
  const actionFilter = pickString(sp.action)
  const entityFilter = pickString(sp.entityType)
  const ctx = await requireRequestContext()
  // The audit log is a sensitive security/forensics surface — restrict reads.
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  const { rows, total, entityTypes } = await ctx.db(async (tx) => {
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
    const [c] = await tx.select({ n: count() }).from(auditLog).where(whereClause)
    const types = await tx
      .selectDistinct({ entityType: auditLog.entityType })
      .from(auditLog)
      .orderBy(asc(auditLog.entityType))
    return {
      rows: data,
      total: Number(c?.n ?? 0),
      entityTypes: types.map((t) => t.entityType),
    }
  })

  return (
    <PageContainer>
      <div className="space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Audit log"
          subtitle="Every write to a tenant-scoped record"
        />
        <TableToolbar>
          <SearchInput placeholder="Search entity type or summary" />
          <FilterChips
            basePath="/admin/audit"
            currentParams={sp}
            paramKey="action"
            label="Action"
            options={ACTION_OPTIONS}
          />
          <FilterChips
            basePath="/admin/audit"
            currentParams={sp}
            paramKey="entityType"
            label="Entity"
            options={entityTypes.map((t) => ({ value: t, label: t }))}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <EmptyState title="No audit entries" />
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
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {formatDateTime(new Date(log.occurredAt), ctx.timezone)}
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-200">
                      {actor?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{log.action}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {log.entityType}
                      {log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell className="text-slate-900 dark:text-slate-100">
                      {log.summary ?? '—'}
                    </TableCell>
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
