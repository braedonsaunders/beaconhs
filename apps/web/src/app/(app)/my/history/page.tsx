import { PageHeader } from '@beaconhs/ui'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { WorkspaceEntryCards } from '@/components/workspace-entry-cards'
import { loadWorkspaceHistory } from '@/lib/workspace-history'
import { WorkspaceNoIdentity } from '../_no-identity'
export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('History') }
}
export default async function WorkspaceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext(),
    sp = await searchParams,
    t = await getGeneratedValueTranslations()
  const history = await loadWorkspaceHistory(ctx, sp)
  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          back={{ href: '/my', label: 'Workspace' }}
          title={t('History')}
          description={t('Your submitted records, document acknowledgments, and safety talks.')}
        />
        {!ctx.membership?.id ? (
          <WorkspaceNoIdentity reason="no-membership" noun="record history" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <SearchInput placeholder={t('Search history')} />
              <FilterChips
                basePath="/my/history"
                currentParams={sp}
                paramKey="kind"
                label={t('Kind')}
                options={[
                  { value: 'journal', label: 'Journal' },
                  { value: 'hazard_assessment', label: 'Hazard assessment' },
                  { value: 'incident', label: 'Incident' },
                  { value: 'inspection', label: 'Inspection' },
                  { value: 'document', label: 'Document acknowledgment' },
                ]}
              />
            </div>
            {history.rows.length ? (
              <WorkspaceEntryCards
                entries={history.rows}
                action="View record"
                timezone={ctx.timezone}
                locale={ctx.locale}
              />
            ) : (
              <p className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800">
                <GeneratedValue value={'No history matches these filters.'} />
              </p>
            )}
            <Pagination
              basePath="/my/history"
              currentParams={sp}
              total={history.total}
              page={history.page}
              perPage={history.perPage}
            />
          </>
        )}
      </div>
    </PageContainer>
  )
}
