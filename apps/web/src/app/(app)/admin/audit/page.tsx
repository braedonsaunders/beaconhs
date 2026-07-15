import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { auditLog, users as user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { PageContainer } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_19635ea35a756a') }
}
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
  const tGenerated = await getGeneratedTranslations()
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
          title={tGenerated('m_19635ea35a756a')}
          subtitle={tGenerated('m_1d95d3a826b700')}
        />
        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_0548446a641230')} />
          <FilterChips
            basePath="/admin/audit"
            currentParams={sp}
            paramKey="action"
            label={tGenerated('m_0bad495a7046e9')}
            options={ACTION_OPTIONS}
          />
          <FilterChips
            basePath="/admin/audit"
            currentParams={sp}
            paramKey="entityType"
            label={tGenerated('m_1c23275efe6385')}
            options={entityTypes.map((t) => ({ value: t, label: t }))}
          />
        </TableToolbar>
        <GeneratedValue
          value={
            rows.length === 0 ? (
              <EmptyState title={tGenerated('m_1f7f13a484a2d6')} />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <GeneratedText id="m_13cc128f69897c" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_163dfc4f85857d" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0bad495a7046e9" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_1c23275efe6385" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_031c356c80b70f" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={rows.map(({ log, actor }) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={formatDateTime(
                                new Date(log.occurredAt),
                                ctx.timezone,
                                ctx.locale,
                              )}
                            />
                          </TableCell>
                          <TableCell className="text-slate-700 dark:text-slate-200">
                            <GeneratedValue value={actor?.name ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              <GeneratedValue value={log.action} />
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                            <GeneratedValue value={log.entityType} />
                            <GeneratedValue
                              value={log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}
                            />
                          </TableCell>
                          <TableCell className="text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={log.summary ?? '—'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    />
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
            )
          }
        />
      </div>
    </PageContainer>
  )
}
