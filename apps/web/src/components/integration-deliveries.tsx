import { Button, Card, CardContent, CardHeader, CardTitle, cn } from '@beaconhs/ui'
import type { RequestContext } from '@beaconhs/tenant'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import {
  deliveriesForAutomation,
  deliveriesForSubject,
  type IntegrationDelivery,
  type IntegrationDeliveryStatus,
} from '@/lib/integration-deliveries'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { resendOutboundDelivery } from '@/app/(app)/admin/integrations/outbound/_actions'
import { FilterChips } from './filter-bar'
import { Pagination } from './pagination'
import { SearchInput } from './search-input'

const STATUS_PILL: Record<IntegrationDeliveryStatus, string> = {
  delivered:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  failed:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
  not_delivered:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
}

function statusLabel(t: (value: string) => string, status: IntegrationDeliveryStatus): string {
  return status === 'delivered'
    ? t('Delivered')
    : status === 'failed'
      ? t('Failed')
      : t('Not delivered')
}

function ResendForm({
  delivery,
  classId,
  label,
}: {
  delivery: IntegrationDelivery
  classId?: string
  label: string
}) {
  return (
    <form action={resendOutboundDelivery}>
      <input type="hidden" name="automationId" value={delivery.automationId} />
      <input type="hidden" name="subjectId" value={delivery.subjectId} />
      <input type="hidden" name="triggerKey" value={delivery.triggerKey} />
      {classId ? <input type="hidden" name="classId" value={classId} /> : null}
      <Button type="submit" size="sm" variant="outline">
        <GeneratedValue value={label} />
      </Button>
    </form>
  )
}

const PER_PAGE = 25

/**
 * Full delivery history for one automation: what landed, what failed (with
 * the destination's error), and what was published but never delivered —
 * each incomplete delivery can be re-sent.
 */
export async function AutomationDeliveries({
  ctx,
  automation,
  subjectLabel,
  basePath,
  searchParams,
}: {
  ctx: RequestContext
  automation: { id: string; name: string | null; triggerKey: string | null }
  subjectLabel: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const t = await getGeneratedValueTranslations()
  const all = await deliveriesForAutomation(ctx, automation)
  const params = parseListParams(
    { page: searchParams.deliveryPage, q: searchParams.deliveryQ },
    { perPage: PER_PAGE, sort: 'date', allowedSorts: ['date'] },
  )
  const statusFilter = pickString(searchParams.deliveryStatus)
  const q = (params.q ?? '').toLowerCase()
  const filtered = all.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false
    if (q && !d.subjectId.toLowerCase().includes(q) && !(d.error ?? '').toLowerCase().includes(q))
      return false
    return true
  })
  const pageRows = filtered.slice((params.page - 1) * PER_PAGE, params.page * PER_PAGE)
  const counts = {
    delivered: all.filter((d) => d.status === 'delivered').length,
    failed: all.filter((d) => d.status === 'failed').length,
    not_delivered: all.filter((d) => d.status === 'not_delivered').length,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedValue value={t('Delivery history')} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput
            placeholder={t('Search by record id or error…')}
            paramKey="deliveryQ"
            pageParamKey="deliveryPage"
          />
          <FilterChips
            basePath={basePath}
            currentParams={searchParams}
            paramKey="deliveryStatus"
            pageParamKey="deliveryPage"
            label={t('Status')}
            options={[
              { value: 'delivered', label: t('Delivered'), count: counts.delivered },
              { value: 'failed', label: t('Failed'), count: counts.failed },
              {
                value: 'not_delivered',
                label: t('Not delivered'),
                count: counts.not_delivered,
              },
            ]}
          />
        </div>
        {pageRows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <GeneratedValue value={t('No deliveries yet.')} />
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Record')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Status')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Last attempt')} />
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <GeneratedValue value={t('Error')} />
                  </th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((d) => (
                  <tr
                    key={`${d.subjectId}:${d.triggerKey}`}
                    className="border-b border-slate-100 align-top dark:border-slate-800"
                  >
                    <td className="py-2 pr-3">
                      <span className="block text-slate-900 dark:text-slate-100">
                        <GeneratedValue value={subjectLabel} />
                      </span>
                      <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={d.subjectId.slice(0, 8)} />
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                          STATUS_PILL[d.status],
                        )}
                      >
                        <GeneratedValue value={statusLabel(t, d.status)} />
                      </span>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      <GeneratedValue
                        value={
                          d.lastAttemptAt
                            ? formatDateTime(d.lastAttemptAt, ctx.timezone, ctx.locale)
                            : '—'
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className="block max-w-md truncate text-xs text-red-600 dark:text-red-400"
                        title={d.error ?? undefined}
                      >
                        <GeneratedValue value={d.error ?? ''} />
                      </span>
                    </td>
                    <td className="py-2">
                      {d.status !== 'delivered' ? (
                        <ResendForm delivery={d} label={t('Re-send')} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          basePath={basePath}
          currentParams={searchParams}
          pageParamKey="deliveryPage"
          page={params.page}
          perPage={PER_PAGE}
          total={filtered.length}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Compact warning for a single record (e.g. a training class): renders only
 * when an automation delivery for this record failed or never landed.
 */
export async function SubjectDeliveryWarnings({
  ctx,
  triggerKey,
  subjectId,
  classId,
  canResend,
}: {
  ctx: RequestContext
  triggerKey: string
  subjectId: string
  classId?: string
  canResend: boolean
}) {
  const t = await getGeneratedValueTranslations()
  const deliveries = (await deliveriesForSubject(ctx, triggerKey, subjectId)).filter(
    (d) => d.status !== 'delivered',
  )
  if (deliveries.length === 0) return null
  return (
    <div className="space-y-2">
      {deliveries.map((d) => (
        <div
          key={d.automationId}
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/40"
        >
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
              STATUS_PILL[d.status],
            )}
          >
            <GeneratedValue value={statusLabel(t, d.status)} />
          </span>
          <span className="text-slate-800 dark:text-slate-200">
            <GeneratedValue value={t('Export to')} />{' '}
            <GeneratedValue value={d.automationName ?? t('an integration')} />
            {d.error ? (
              <>
                {' — '}
                <span className="text-red-700 dark:text-red-300">
                  <GeneratedValue value={d.error} />
                </span>
              </>
            ) : null}
          </span>
          {canResend ? (
            <span className="ml-auto">
              <ResendForm delivery={d} classId={classId} label={t('Re-send')} />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
