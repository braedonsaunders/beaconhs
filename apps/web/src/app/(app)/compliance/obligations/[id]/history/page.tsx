import Link from 'next/link'
import { notFound } from 'next/navigation'
import { COMPLIANCE_HISTORY_LIMITS, supportsComplianceHistory } from '@beaconhs/compliance'
import { loadComplianceHistory } from './_data'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { StatusBadge } from '../../../_shared'
import { QuantityPeriod, QuantityProgress } from '../../../_quantity-progress'
import { isCalendarQuantity } from '../../_meta'
import { PersonPicker } from '../../../by-person/_person-picker'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Compliance history') }
}
export const dynamic = 'force-dynamic'

export default async function ComplianceHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams,
    ctx = await requireRequestContext()
  const tGeneratedValue = await getGeneratedValueTranslations()
  const requestedPerson = pickString(sp.person)
  const limitValue = Number(pickString(sp.periods) ?? 12)
  const limit = COMPLIANCE_HISTORY_LIMITS.find((value) => value === limitValue) ?? 12
  const data = await loadComplianceHistory(
    ctx,
    id,
    limit,
    requestedPerson && isUuid(requestedPerson) ? requestedPerson : undefined,
  )
  if (!data) notFound()
  const { canReadAll, personId } = data
  const basePath = `/compliance/obligations/${id}/history`
  const list = parseListParams(sp, {
    sort: 'period',
    dir: 'desc',
    perPage: 25,
    allowedSorts: ['period'],
  })
  const q = list.q?.toLowerCase()
  const resultFilter = pickString(sp.result)
  const rows = data.history.filter(
    (row) =>
      (!q ||
        [row.label, row.title, row.periodStart, row.periodEnd]
          .join(' ')
          .toLowerCase()
          .includes(q)) &&
      (resultFilter === 'met'
        ? row.status === 'completed'
        : resultFilter === 'unmet'
          ? row.status !== 'completed'
          : true),
  )
  const page = Math.min(list.page, Math.max(1, Math.ceil(rows.length / list.perPage)))
  const shown = rows.slice((page - 1) * list.perPage, page * list.perPage)
  const met = rows.filter((row) => row.status === 'completed').length
  return (
    <PageContainer>
      <div className="space-y-5">
        <Link
          href={
            canReadAll && !data.ob.deletedAt ? `/compliance/obligations/${id}` : '/compliance/mine'
          }
          className="text-sm text-teal-700 hover:underline dark:text-teal-300"
        >
          <GeneratedValue value="Back to compliance" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            <GeneratedValue value="Compliance history" />
          </h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">{data.ob.title}</p>
        </div>
        <p className="max-w-4xl text-sm text-slate-600 dark:text-slate-400">
          <GeneratedValue value="Review completed periods. Recorded periods keep the last saved rule and assigned people for that period. Older periods are reconstructed using the current rule and audience. Results use the evidence currently in the app, including later corrections." />
        </p>
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Periods ending while a requirement is inactive are excluded." />
        </p>
        {data.supported && !supportsComplianceHistory(data.ob) ? (
          <p className="text-sm text-slate-500">
            <GeneratedValue value="This requirement no longer has separate calendar periods. Its previously recorded periods remain available below." />
          </p>
        ) : null}
        {!data.supported ? (
          <p className="rounded-lg border p-5 text-sm">
            <GeneratedValue value="This requirement has no separate calendar periods. Rolling validity, one-time deadlines and continuous expiry requirements are shown in current compliance." />
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              {canReadAll ? (
                <PersonPicker
                  selected={personId ?? ''}
                  emptyLabel={tGeneratedValue('All people')}
                  selectedLabel={data.history.find((row) => row.personId === personId)?.label}
                  basePath={basePath}
                  currentParams={sp}
                />
              ) : null}
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="periods"
                label={tGeneratedValue('Completed periods')}
                hideAll
                defaultValue="12"
                options={COMPLIANCE_HISTORY_LIMITS.map((value) => ({
                  value: String(value),
                  label: String(value),
                }))}
              />
            </div>
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <span className="text-2xl font-semibold">
                {rows.length ? Math.round((met / rows.length) * 100) : '—'}
                {rows.length ? '%' : ''}
              </span>
              <p className="text-sm text-slate-500">
                <GeneratedValue value="Targets met" />: {met} / {rows.length}
              </p>
            </div>
            <TableToolbar>
              <SearchInput placeholder={tGeneratedValue('Search people or periods…')} />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="result"
                label={tGeneratedValue('Result')}
                options={[
                  { value: 'met', label: 'Met' },
                  { value: 'unmet', label: 'Unmet' },
                ]}
              />
            </TableToolbar>
            {shown.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
                <GeneratedValue value="No completed periods match. History starts when this requirement was created." />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <GeneratedValue value="Period" />
                    </TableHead>
                    <TableHead>
                      <GeneratedValue value="Person" />
                    </TableHead>
                    <TableHead>
                      <GeneratedValue value="Result" />
                    </TableHead>
                    <TableHead>
                      <GeneratedValue value="Progress" />
                    </TableHead>
                    <TableHead>
                      <GeneratedValue value="Due" />
                    </TableHead>
                    <TableHead>
                      <GeneratedValue value="Rule source" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((row) => (
                    <TableRow key={`${row.key}:${row.periodKey}`}>
                      <TableCell className="min-w-48">
                        <QuantityPeriod
                          start={row.periodStart}
                          end={row.periodEnd}
                          locale={ctx.locale}
                        />
                        <div className="text-xs text-slate-500">{row.title}</div>
                        {row.cronPeriod ? (
                          <div className="text-xs text-slate-500">
                            {formatDateTime(new Date(row.periodStartAt), row.timezone, ctx.locale)}{' '}
                            – {formatDateTime(new Date(row.periodEndAt), row.timezone, ctx.locale)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-36">
                        {canReadAll && row.personId ? (
                          <Link
                            className="text-teal-700 hover:underline dark:text-teal-300"
                            href={mergeHref(basePath, sp, {
                              person: row.personId,
                              page: undefined,
                            })}
                          >
                            {row.label}
                          </Link>
                        ) : (
                          row.label
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        {row.expected != null ? (
                          isCalendarQuantity(data.ob) ? (
                            <QuantityProgress
                              count={row.count ?? 0}
                              expected={row.expected}
                              met={row.status === 'completed'}
                              noun={
                                data.ob.sourceModule === 'inspection'
                                  ? 'inspections'
                                  : data.ob.sourceModule === 'hazard_assessment'
                                    ? 'assessments'
                                    : 'submitted'
                              }
                            />
                          ) : (
                            <span className="tabular-nums">
                              {row.count ?? 0} / {row.expected}
                            </span>
                          )
                        ) : (
                          <GeneratedValue value={row.status === 'completed' ? 'Met' : 'Unmet'} />
                        )}
                      </TableCell>
                      <TableCell>
                        {row.dueOn
                          ? formatDate(new Date(`${row.dueOn}T00:00:00Z`), 'UTC', ctx.locale)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <GeneratedValue
                            value={row.recorded ? 'Recorded rule' : 'Reconstructed'}
                          />
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Pagination
              basePath={basePath}
              currentParams={sp}
              total={rows.length}
              page={page}
              perPage={list.perPage}
            />
          </>
        )}
      </div>
    </PageContainer>
  )
}
