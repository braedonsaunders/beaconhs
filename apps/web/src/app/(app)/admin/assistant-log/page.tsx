import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import {
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { loadAssistantActivity } from '@/lib/assistant/activity'
import { formatDateTime } from '@/lib/datetime'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { DateRangeFilter } from '@/components/log-filters'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Assistant log') }
}

export default async function AssistantLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')
  const sp = await searchParams
  const { params, rows, totals, actors } = await loadAssistantActivity(ctx, sp)
  const t = await getGeneratedValueTranslations()
  const basePath = '/admin/assistant-log'
  const date = (at: Date) => formatDateTime(at, ctx.timezone, ctx.locale)
  return (
    <ListPageLayout
      header={
        <>
          <DetailHeader
            title={t('Assistant log')}
            back={{ href: '/admin', label: t('Back to admin') }}
            subtitle={t(
              'Saved assistant usage. Conversation contents stay private. Deleted conversations are not included.',
            )}
          />
          <TableToolbar>
            <SearchInput placeholder={t('Search users…')} />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="user"
              label={t('User')}
              options={actors}
            />
            <FilterChips
              basePath={basePath}
              currentParams={sp}
              paramKey="outcome"
              label={t('Response outcome')}
              options={[
                { value: 'failed', label: t('Failed') },
                { value: 'stopped', label: t('Stopped') },
                { value: 'unanswered', label: t('Awaiting response') },
              ]}
            />
            <DateRangeFilter />
          </TableToolbar>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        {t('Conversations')}: {totals.conversations} · {t('Questions')}: {totals.prompts} ·{' '}
        {t('Responses')}: {totals.replies}
      </p>
      {rows.length === 0 ? (
        <EmptyState
          title={t('No assistant usage found')}
          description={t(
            'Try another user or date range. New conversations appear after the first question is saved.',
          )}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'User',
                'First used',
                'Last used',
                'Questions',
                'Responses',
                'Failed',
                'Stopped',
              ].map((label) => (
                <TableHead key={label}>{t(label)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.userName ?? t('Unknown user')}</TableCell>
                <TableCell className="whitespace-nowrap">{date(row.firstUsed)}</TableCell>
                <TableCell className="whitespace-nowrap">{date(row.lastUsed)}</TableCell>
                <TableCell>{row.prompts}</TableCell>
                <TableCell>{row.replies}</TableCell>
                <TableCell>{row.failed}</TableCell>
                <TableCell>{row.stopped}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        basePath={basePath}
        currentParams={sp}
        total={totals.conversations}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
