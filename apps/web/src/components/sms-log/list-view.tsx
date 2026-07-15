import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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

  const loadRows = async (tx: Database) => {
    const filters: SQL<unknown>[] = []
    // Platform/account messages are visible only in the super-admin platform
    // route. Tenant admins see exactly their own rows.
    if (scope === 'tenant') {
      filters.push(eq(smsLog.tenantId, ctx.tenantId))
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
  }
  const { rows, total, categoryFacets } =
    scope === 'platform' ? await withSuperAdmin(db, loadRows) : await ctx.db(loadRows)

  return (
    <ListPageLayout
      header={
        <>
          <DetailHeader
            back={back}
            title={tGenerated('m_1e58ae4efd7912')}
            subtitle={tGeneratedValue(
              scope === 'platform'
                ? tGenerated('m_0b66d20fff304b')
                : tGenerated('m_1ef8c6970e1d32'),
            )}
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1666870ccf1991')} />
            <TextParamFilter
              paramKey="recipient"
              label={tGenerated('m_105e441033d31d')}
              type="tel"
              placeholder="+15551234567"
              className="h-8 w-48"
            />
            <DateRangeFilter />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS}
            />
            <GeneratedValue
              value={
                categoryFacets.length > 0 ? (
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey="category"
                    label={tGenerated('m_108b41637f364f')}
                    options={categoryFacets}
                  />
                ) : null
              }
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              title={tGenerated('m_14fee9d67d6101')}
              description={tGenerated('m_110381de3e8ecc')}
            />
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <GeneratedText id="m_13cc128f69897c" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0ea10a854847b2" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0e4ff640f8e7d6" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_108b41637f364f" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </TableHead>
                    <GeneratedValue
                      value={
                        showTenant ? (
                          <TableHead>
                            <GeneratedText id="m_1fd4a056042e4d" />
                          </TableHead>
                        ) : null
                      }
                    />
                    <TableHead className="text-right">
                      <GeneratedText id="m_1b34818ce3a832" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ log, tenant }) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                          <GeneratedValue
                            value={formatDateTime(
                              new Date(log.createdAt),
                              ctx.timezone,
                              ctx.locale,
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-slate-900 dark:text-slate-100">
                          <div className="font-mono text-xs">
                            <GeneratedValue value={log.recipient ?? '—'} />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md truncate text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={log.body ?? '—'} />
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <GeneratedValue
                            value={
                              log.categoryKey ? (
                                <Badge variant="outline" className="font-mono text-[11px]">
                                  <GeneratedValue value={log.categoryKey} />
                                </Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={statusVariant(log.status)}>
                              <GeneratedValue value={log.status} />
                            </Badge>
                            <GeneratedValue
                              value={
                                log.provider && log.status === 'sent' ? (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_1a68dfb8697673" />{' '}
                                    <GeneratedValue value={log.provider} />
                                  </span>
                                ) : null
                              }
                            />
                          </div>
                          <GeneratedValue
                            value={
                              log.status === 'failed' && log.errorMessage ? (
                                <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-700 dark:text-red-400">
                                  <GeneratedValue value={log.errorMessage} />
                                </div>
                              ) : null
                            }
                          />
                        </TableCell>
                        <GeneratedValue
                          value={
                            showTenant ? (
                              <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                <GeneratedValue
                                  value={
                                    tenant?.name ?? (
                                      <span className="text-slate-400">
                                        <GeneratedText id="m_123000091889d1" />
                                      </span>
                                    )
                                  }
                                />
                              </TableCell>
                            ) : null
                          }
                        />
                        <TableCell className="text-right">
                          <Link
                            href={`${basePath}/${log.id}` as never}
                            className="text-teal-700 hover:underline dark:text-teal-400"
                          >
                            <GeneratedText id="m_107ab58c3c38bc" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
