import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /journals/records — the admin / safety "browse all journals" surface.
// A standard list page (header + sortable table + filter toolbar + pagination)
// over every entry the viewer is allowed to see. Rows open a read-only flyout,
// and "Open full entry" opens a larger editable workspace scoped to that
// author's journals — both client-state driven (see _records-table.tsx), so
// opening/closing them never re-queries the list. Visibility is the journal read
// tier (read.all → tenant-wide, read.site → your sites + your own, read.self →
// your own only); the page is gated to managers — self-tier users go to /journals.

import { redirect } from 'next/navigation'
import { BookText } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { buildExportHref, isUuid, parseListParams, pickString } from '@/lib/list-params'
import { countEntries, listEntries, listRecordsFacets, listTagColors } from '../_data'
import { journalCanBrowseAll } from '../_lib'
import {
  JOURNAL_TAG_NAME_LIMIT,
  type JournalDefinition,
  type JournalFilters,
  type JournalSort,
  type JournalStatus,
} from '../_types'
import { JournalRecordsTable } from './_records-table'
import {
  loadJournalRecordAuthorOptions,
  loadJournalRecordSiteOptions,
  loadJournalRecordTagOptions,
} from './_tag-picker-actions'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_04515b24a6cbe3') }
}

const SORTS: readonly JournalSort[] = ['date', 'author', 'site', 'status', 'reference']

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]
const TYPE_OPTIONS = [
  { value: 'worker', label: 'Worker' },
  { value: 'supervisor', label: 'Supervisor' },
]

function validDateParam(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

export default async function JournalRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) redirect('/journals')
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'journals.read.self')

  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const statusParam = pickString(sp.status)
  const definitionParam = pickString(sp.definition)
  const siteParam = pickString(sp.site)
  const personParam = pickString(sp.person)
  const tagParam = pickString(sp.tag)
  const filters: JournalFilters = {
    q: params.q,
    status: STATUS_OPTIONS.some((option) => option.value === statusParam)
      ? (statusParam as JournalStatus)
      : undefined,
    definition: TYPE_OPTIONS.some((option) => option.value === definitionParam)
      ? (definitionParam as JournalDefinition)
      : undefined,
    site: siteParam && isUuid(siteParam) ? siteParam : undefined,
    person: personParam && isUuid(personParam) ? personParam : undefined,
    tag:
      tagParam &&
      tagParam.length <= JOURNAL_TAG_NAME_LIMIT &&
      !/[\u0000-\u001f\u007f]/.test(tagParam)
        ? tagParam
        : undefined,
    from: validDateParam(pickString(sp.from)),
    to: validDateParam(pickString(sp.to)),
  }
  const fromRaw = filters.from ?? ''
  const toRaw = filters.to ?? ''

  const [items, total, facets] = await Promise.all([
    listEntries(ctx, filters, {
      limit: params.perPage,
      offset: (params.page - 1) * params.perPage,
      sort: params.sort,
      dir: params.dir,
    }),
    countEntries(ctx, filters),
    listRecordsFacets(ctx),
  ])

  const tagColors = await listTagColors(
    ctx,
    items.flatMap((item) => item.tags),
  )
  const sortProps = {
    basePath: '/journals/records',
    currentParams: sp,
    sort: params.sort,
    dir: params.dir,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_04515b24a6cbe3')}
            description={tGenerated('m_052281e1e91a00')}
            actions={
              canExport ? (
                <a href={buildExportHref('/journals/export.csv', sp)}>
                  <Button variant="outline">
                    <GeneratedText id="m_14c6440eca1edc" />
                  </Button>
                </a>
              ) : null
            }
          />
          <ModuleNav moduleKey="journals" active="records" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0cec466d6457e1')} />
            <FilterChips
              basePath="/journals/records"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              allLabel="Any status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: facets.statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/journals/records"
              currentParams={sp}
              paramKey="definition"
              label={tGenerated('m_074ba2f160c506')}
              allLabel="Any type"
              options={TYPE_OPTIONS}
            />
            <RemoteSearchFilter
              loadOptions={loadJournalRecordAuthorOptions}
              basePath="/journals/records"
              currentParams={sp}
              paramKey="person"
              placeholder={tGenerated('m_102255d7ce7611')}
              allLabel="All authors"
              searchPlaceholder={tGenerated('m_0a8edb9f718779')}
              ariaLabel="Filter journal records by author"
            />
            <RemoteSearchFilter
              loadOptions={loadJournalRecordSiteOptions}
              basePath="/journals/records"
              currentParams={sp}
              paramKey="site"
              placeholder={tGenerated('m_1a37e747f6006b')}
              allLabel="All locations"
              searchPlaceholder={tGenerated('m_1545cf488b21b6')}
              ariaLabel="Filter journal records by location"
            />
            <RemoteSearchFilter
              loadOptions={loadJournalRecordTagOptions}
              basePath="/journals/records"
              currentParams={sp}
              paramKey="tag"
              placeholder={tGenerated('m_0834b9f57a434d')}
              allLabel="Any tag"
              searchPlaceholder={tGenerated('m_11dafb1e93f6ca')}
              ariaLabel="Filter journal records by tag"
            />
            <form method="get" className="flex items-center gap-1 text-xs">
              <GeneratedValue
                value={Object.entries({
                  q: filters.q,
                  status: filters.status,
                  definition: filters.definition,
                  site: filters.site,
                  person: filters.person,
                  tag: filters.tag,
                  sort: params.sort !== 'date' ? params.sort : undefined,
                  dir: params.dir !== 'desc' ? params.dir : undefined,
                })
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={String(v)} />
                  ))}
              />
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_154c9d7a784dda" />
                <input
                  type="date"
                  name="from"
                  defaultValue={fromRaw}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_02d4f83ff8f11c" />
                <input
                  type="date"
                  name="to"
                  defaultValue={toRaw}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </label>
              <button
                type="submit"
                className="h-8 rounded-md border border-slate-200 px-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <GeneratedText id="m_01185cdc1c20a5" />
              </button>
            </form>
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyState
              icon={<BookText size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_0f2e18c75b0f31', { value0: params.q })
                  : tGenerated('m_097ebca00485be'),
              )}
              description={tGenerated('m_041e29cfede4d7')}
            />
          ) : (
            <>
              <JournalRecordsTable items={items} tagColors={tagColors} sortProps={sortProps} />
              <Pagination
                basePath="/journals/records"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
