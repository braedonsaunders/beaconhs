import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// Shared email-log list — rendered at two routes:
//   • /admin/email-log    (scope: 'tenant')   — only the active tenant's mail.
//   • /platform/email-log (scope: 'platform') — every tenant's mail (the
//     platform layout already gates this to super-admins).
//
// The list deliberately does NOT select htmlBody/textBody — they live on the
// row but get fetched on the detail page only, to keep the list payload tight
// when a tenant has 100k+ rows.

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

export type EmailLogScope = 'tenant' | 'platform'

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

export async function EmailLogListView({
  searchParams: sp,
  scope,
  basePath,
  back,
}: {
  searchParams: Record<string, string | string[] | undefined>
  scope: EmailLogScope
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
    // Platform/account mail can contain login links and is visible only in the
    // super-admin platform route. Tenant admins see exactly their own rows.
    if (scope === 'tenant') {
      filters.push(eq(emailLog.tenantId, ctx.tenantId))
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
      filters.push(eq(emailLog.status, statusFilter as never))
    }
    if (categoryFilter) {
      filters.push(eq(emailLog.categoryKey, categoryFilter))
    }
    if (recipientFilter) {
      filters.push(ilike(emailLog.recipientPrimary, `%${recipientFilter}%`))
    }
    // Ignore malformed date params — new Date('garbage') doesn't throw, it
    // returns an Invalid Date that blows up during query serialization.
    if (fromDate) {
      const start = new Date(fromDate)
      if (!Number.isNaN(start.getTime())) filters.push(gte(emailLog.createdAt, start))
    }
    if (toDate) {
      const end = new Date(toDate)
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999)
        filters.push(lte(emailLog.createdAt, end))
      }
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
          meta: emailLog.meta,
        },
        tenant: { id: tenants.id, name: tenants.name },
      })
      .from(emailLog)
      .leftJoin(tenants, eq(tenants.id, emailLog.tenantId))
      .where(whereClause)
      .orderBy(desc(emailLog.createdAt))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const [c] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(emailLog)
      .where(whereClause)

    const facetRows = await tx
      .select({
        categoryKey: emailLog.categoryKey,
        n: sql<number>`count(*)::int`,
      })
      .from(emailLog)
      .where(and(...filters, sql`${emailLog.categoryKey} IS NOT NULL`))
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
  }
  const { rows, total, categoryFacets } =
    scope === 'platform' ? await withSuperAdmin(db, loadRows) : await ctx.db(loadRows)

  return (
    <ListPageLayout
      header={
        <>
          <DetailHeader
            back={back}
            title={tGenerated('m_0d39bd3942858a')}
            subtitle={tGeneratedValue(
              scope === 'platform'
                ? tGenerated('m_023f7eb7992137')
                : tGenerated('m_1dea311c55812b'),
            )}
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_10858dfc509907')} />
            <TextParamFilter
              paramKey="recipient"
              label={tGenerated('m_105e441033d31d')}
              placeholder={tGenerated('m_109ef76b347378')}
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
              title={tGenerated('m_0354e8b6b89ed9')}
              description={tGenerated('m_1654c1b4c9c833')}
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
                      <GeneratedText id="m_1928431de4aaf1" />
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
                    value={rows.map(({ log, tenant }) => {
                      const otherCount = Array.isArray(log.recipients)
                        ? log.recipients.length - 1
                        : 0
                      return (
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
                              <GeneratedValue value={log.recipientPrimary ?? '—'} />
                            </div>
                            <GeneratedValue
                              value={
                                otherCount > 0 ? (
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    +<GeneratedValue value={otherCount} />{' '}
                                    <GeneratedText id="m_08f0d8b65511f2" />
                                    <GeneratedValue
                                      value={
                                        otherCount === 1 ? (
                                          ''
                                        ) : (
                                          <GeneratedText id="m_00ded356f0f424" />
                                        )
                                      }
                                    />
                                  </div>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-md truncate text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={log.subject} />
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
                            <GeneratedValue
                              value={(() => {
                                const meta = (log.meta ?? {}) as Record<string, unknown>
                                const provider =
                                  typeof meta.provider === 'string' ? meta.provider : null
                                const suppressed = meta.suppressed === true
                                return (
                                  <>
                                    <div className="flex flex-wrap items-center gap-1">
                                      <Badge variant={statusVariant(log.status)}>
                                        <GeneratedValue value={log.status} />
                                      </Badge>
                                      <GeneratedValue
                                        value={
                                          suppressed ? (
                                            <Badge variant="outline" className="text-[11px]">
                                              <GeneratedText id="m_038f9741d2b329" />
                                            </Badge>
                                          ) : null
                                        }
                                      />
                                      <GeneratedValue
                                        value={
                                          provider && provider !== 'suppressed' ? (
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                              <GeneratedText id="m_1a68dfb8697673" /> {provider}
                                            </span>
                                          ) : null
                                        }
                                      />
                                    </div>
                                    <GeneratedValue
                                      value={
                                        log.status === 'failed' &&
                                        log.errorMessage &&
                                        !suppressed ? (
                                          <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-700 dark:text-red-400">
                                            {log.errorMessage}
                                          </div>
                                        ) : null
                                      }
                                    />
                                  </>
                                )
                              })()}
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
                      )
                    })}
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
