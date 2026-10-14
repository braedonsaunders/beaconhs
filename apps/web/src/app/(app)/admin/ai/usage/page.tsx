import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { aiUsageEvents, tenantUsers } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { FilterChips } from '@/components/filter-bar'
import { PageContainer } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { getTenantAiResolution } from '@/lib/ai-config'
import { AI_FEATURE_LABEL, aiFeatureLabel } from '@/lib/ai-usage'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0f677254139292') }
}

const BASE = '/admin/ai/usage'
const SORTS = ['created_at', 'tokens', 'latency'] as const

/** UTC calendar month containing `ym` (YYYY-MM), matching the budget period. */
function monthRange(ym: string): { start: Date; end: Date } {
  const [y, m] = ym.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)),
    end: new Date(Date.UTC(y ?? 1970, m ?? 1, 1)),
  }
}

function recentMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'created_at',
    dir: 'desc',
    perPage: 50,
    allowedSorts: SORTS,
  })
  const now = new Date()
  const months = recentMonths(now, 12)
  const currentMonth = months[0] ?? ''
  const monthParam = pickString(sp.month)
  const month = monthParam && months.includes(monthParam) ? monthParam : currentMonth
  const featureFilter = pickString(sp.feature)
  const outcomeParam = pickString(sp.outcome)
  const outcomeFilter =
    outcomeParam === 'succeeded' || outcomeParam === 'failed' ? outcomeParam : undefined
  const { start, end } = monthRange(month)

  const resolution = await getTenantAiResolution(ctx)
  const budget = resolution.budget

  const data = await ctx.db(async (tx) => {
    const period = and(gte(aiUsageEvents.createdAt, start), lt(aiUsageEvents.createdAt, end))
    const filters: SQL[] = []
    if (period) filters.push(period)
    if (featureFilter) filters.push(eq(aiUsageEvents.feature, featureFilter))
    if (outcomeFilter) filters.push(eq(aiUsageEvents.outcome, outcomeFilter))
    if (params.q) {
      const term = `%${params.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
      const match = or(
        ilike(aiUsageEvents.feature, term),
        ilike(aiUsageEvents.model, term),
        ilike(tenantUsers.displayName, term),
      )
      if (match) filters.push(match)
    }
    const where = and(...filters)
    const totalTokens = sql<number>`${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}`
    const order =
      params.sort === 'tokens'
        ? totalTokens
        : params.sort === 'latency'
          ? aiUsageEvents.latencyMs
          : aiUsageEvents.createdAt
    const [rows, [filteredCount], [totals], byFeature, byModel] = await Promise.all([
      tx
        .select({ event: aiUsageEvents, member: tenantUsers.displayName })
        .from(aiUsageEvents)
        .leftJoin(tenantUsers, eq(tenantUsers.id, aiUsageEvents.tenantUserId))
        .where(where)
        .orderBy(params.dir === 'asc' ? asc(order) : desc(order), desc(aiUsageEvents.id))
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
      tx
        .select({ n: count() })
        .from(aiUsageEvents)
        .leftJoin(tenantUsers, eq(tenantUsers.id, aiUsageEvents.tenantUserId))
        .where(where),
      tx
        .select({
          calls: count(),
          failed: sql<string>`count(*) filter (where ${aiUsageEvents.outcome} = 'failed')`,
          input: sql<string>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
          output: sql<string>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
        })
        .from(aiUsageEvents)
        .where(period),
      tx
        .select({
          feature: aiUsageEvents.feature,
          calls: count(),
          tokens: sql<string>`coalesce(sum(${totalTokens}), 0)`,
        })
        .from(aiUsageEvents)
        .where(period)
        .groupBy(aiUsageEvents.feature)
        .orderBy(desc(sql`3`), asc(aiUsageEvents.feature)),
      tx
        .select({
          provider: aiUsageEvents.provider,
          model: aiUsageEvents.model,
          calls: count(),
          tokens: sql<string>`coalesce(sum(${totalTokens}), 0)`,
        })
        .from(aiUsageEvents)
        .where(period)
        .groupBy(aiUsageEvents.provider, aiUsageEvents.model)
        .orderBy(desc(sql`4`)),
    ])
    return {
      rows,
      total: Number(filteredCount?.n ?? 0),
      calls: Number(totals?.calls ?? 0),
      failed: Number(totals?.failed ?? 0),
      input: Number(totals?.input ?? 0),
      output: Number(totals?.output ?? 0),
      byFeature: byFeature.map((r) => ({ ...r, tokens: Number(r.tokens) })),
      byModel: byModel.map((r) => ({ ...r, tokens: Number(r.tokens) })),
    }
  })

  const used = data.input + data.output
  const isCurrent = month === currentMonth
  const budgetPct =
    isCurrent && budget.limit ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : null
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }
  const numberFormat = new Intl.NumberFormat(ctx.locale)
  const tokens = (n: number) => numberFormat.format(n)
  const seconds = new Intl.NumberFormat(ctx.locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 1,
  })

  return (
    <PageContainer>
      <div className="space-y-4">
        <DetailHeader
          back={{ href: '/admin/ai', label: 'Back to AI settings' }}
          title={tGenerated('m_0f677254139292')}
          subtitle={tGenerated('m_1818609e23792c')}
        />
        <FilterChips
          basePath={BASE}
          currentParams={sp}
          paramKey="month"
          label={tGenerated('m_195e017a11ba03')}
          allLabel={tGenerated('m_11542ea506a7f5')}
          options={months.slice(1).map((value) => ({
            value,
            label: new Intl.DateTimeFormat(ctx.locale, {
              timeZone: 'UTC',
              month: 'long',
              year: 'numeric',
            }).format(monthRange(value).start),
          }))}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_0ddb1a0f1b4886" />
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {tokens(used)}
              </p>
              <p className="text-xs text-slate-500">
                <GeneratedValue
                  value={tGenerated('m_079317a8c23fe3', {
                    value0: tokens(data.input),
                    value1: tokens(data.output),
                  })}
                />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_14bad7b52a0fba" />
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {tokens(data.calls)}
              </p>
              <p className="text-xs text-slate-500">
                <GeneratedValue
                  value={tGenerated('m_035d761e562bc3', { value0: tokens(data.failed) })}
                />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_0f08d207f0dbd1" />
              </p>
              {budget.limit && isCurrent ? (
                <>
                  <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {budgetPct}%
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={
                        budgetPct !== null && budgetPct >= 100
                          ? 'h-full bg-red-500'
                          : budgetPct !== null && budgetPct >= 80
                            ? 'h-full bg-amber-500'
                            : 'h-full bg-teal-500'
                      }
                      style={{ width: `${budgetPct ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <GeneratedValue
                      value={tGenerated('m_0a8fb1aa51cd20', {
                        value0: tokens(budget.used),
                        value1: tokens(budget.limit),
                        value2: formatDate(budget.resetsAt, 'UTC', ctx.locale),
                      })}
                    />
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {budget.limit ? (
                    <GeneratedValue
                      value={tGenerated('m_16bf87cf1d314d', { value0: tokens(budget.limit) })}
                    />
                  ) : (
                    <GeneratedText id="m_1335b2e2914faa" />
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_1477f2dcb35151" />
              </h2>
              {data.byFeature.length === 0 ? (
                <p className="text-sm text-slate-500">
                  <GeneratedText id="m_1875197b97c078" />
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {data.byFeature.map((row) => (
                    <li
                      key={row.feature}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="text-slate-700 dark:text-slate-200">
                        <GeneratedValue value={aiFeatureLabel(row.feature)} />
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        <GeneratedValue
                          value={tGenerated('m_1bb51227498600', {
                            value0: tokens(row.tokens),
                            value1: tokens(row.calls),
                          })}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_0ffee70ee7829a" />
              </h2>
              {data.byModel.length === 0 ? (
                <p className="text-sm text-slate-500">
                  <GeneratedText id="m_1875197b97c078" />
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {data.byModel.map((row) => (
                    <li
                      key={`${row.provider}:${row.model}`}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-200">
                        {row.provider} · {row.model}
                      </span>
                      <span className="shrink-0 text-slate-500 tabular-nums">
                        <GeneratedValue
                          value={tGenerated('m_1bb51227498600', {
                            value0: tokens(row.tokens),
                            value1: tokens(row.calls),
                          })}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_16240fce7258ba')} />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="feature"
            label={tGenerated('m_042b146cf1b619')}
            options={Object.entries(AI_FEATURE_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="outcome"
            label={tGenerated('m_00da71f1bd869e')}
            options={[
              { value: 'succeeded', label: 'Succeeded' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </TableToolbar>
        {data.rows.length === 0 ? (
          <EmptyState title={tGenerated('m_168b5f3c7dccdb')} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="created_at"
                      active={params.sort === 'created_at'}
                    >
                      <GeneratedText id="m_13cc128f69897c" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_042b146cf1b619" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0765ed97aa75fc" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_12e926c9216094" />
                    </TableHead>
                    <SortableTh
                      {...sortProps}
                      column="tokens"
                      active={params.sort === 'tokens'}
                      align="right"
                    >
                      <GeneratedText id="m_0ddb1a0f1b4886" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="latency"
                      active={params.sort === 'latency'}
                      align="right"
                    >
                      <GeneratedText id="m_1241d8588e6fc5" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_00da71f1bd869e" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map(({ event, member }) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-sm whitespace-nowrap text-slate-600 dark:text-slate-300">
                        <GeneratedValue
                          value={formatDateTime(event.createdAt, ctx.timezone, ctx.locale)}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-slate-800 dark:text-slate-100">
                        <GeneratedValue value={aiFeatureLabel(event.feature)} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {event.model}
                        <span className="text-slate-400"> · {event.tier}</span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                        <GeneratedValue value={member ?? '—'} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {tokens(event.inputTokens + event.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500 tabular-nums">
                        {seconds.format(event.latencyMs / 1000)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={event.outcome === 'failed' ? 'destructive' : 'success'}>
                          <GeneratedValue
                            value={event.outcome === 'failed' ? 'Failed' : 'Succeeded'}
                          />
                        </Badge>
                        {event.error ? (
                          <p
                            className="mt-1 max-w-xs truncate text-xs text-red-600 dark:text-red-400"
                            title={event.error}
                          >
                            <GeneratedValue value={event.error} />
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath={BASE}
              currentParams={sp}
              total={data.total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}
      </div>
    </PageContainer>
  )
}
