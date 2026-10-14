// Per-recipient email delivery status for a scheduled run (reports and AI
// briefs). Searchable, filterable by status, and paginated with prefixed URL
// params so it can sit on a page beside other lists.

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@beaconhs/ui'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { formatDateTime } from '@/lib/datetime'
import { pickString } from '@/lib/list-params'

export type DeliveryRow = {
  id: string
  recipientEmail: string
  status: 'queued' | 'enqueued' | 'sent' | 'failed'
  error: string | null
  sentAt: Date | null
}

const STATUS_VARIANT = {
  queued: 'secondary',
  enqueued: 'warning',
  sent: 'success',
  failed: 'destructive',
} as const

const STATUS_LABEL = {
  queued: 'Queued',
  enqueued: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
} as const

const PER_PAGE = 20

export async function DeliveryStatusTable({
  rows,
  basePath,
  currentParams,
  timezone,
  locale,
}: {
  rows: DeliveryRow[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  timezone: string
  locale: Parameters<typeof formatDateTime>[2]
}) {
  const tGenerated = await getGeneratedTranslations()
  const q = pickString(currentParams.deliveryQ)?.trim().toLowerCase() ?? ''
  const status = pickString(currentParams.deliveryStatus)
  const filtered = rows.filter(
    (row) => (!q || row.recipientEmail.includes(q)) && (!status || row.status === status),
  )
  const page = Math.max(1, Number(pickString(currentParams.deliveryPage) ?? 1) || 1)
  const visible = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  return (
    <div className="space-y-3">
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_1848ca1255cbbb')}
          paramKey="deliveryQ"
          pageParamKey="deliveryPage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="deliveryStatus"
          pageParamKey="deliveryPage"
          label={tGenerated('m_03db87cb2e7846')}
          options={[
            { value: 'sent', label: 'Sent' },
            { value: 'enqueued', label: 'Sending' },
            { value: 'queued', label: 'Queued' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </TableToolbar>
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">
          {rows.length === 0 ? (
            <GeneratedText id="m_020339bd6e1174" />
          ) : (
            <GeneratedText id="m_093d85c8ac6fc6" />
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <GeneratedText id="m_105e441033d31d" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0b9da892d6faf0" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_1278d536a58359" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">
                    {row.recipientEmail}
                    {row.error ? (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        <GeneratedValue value={row.error} />
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      <GeneratedValue value={STATUS_LABEL[row.status]} />
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-slate-500">
                    <GeneratedValue
                      value={row.sentAt ? formatDateTime(row.sentAt, timezone, locale) : '—'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={basePath}
        currentParams={currentParams}
        total={filtered.length}
        page={page}
        perPage={PER_PAGE}
        pageParamKey="deliveryPage"
      />
    </div>
  )
}
