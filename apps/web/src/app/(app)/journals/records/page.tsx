// /journals/records — the admin / safety "browse all journals" surface.
// A standard list page (header + sortable table + filter toolbar + pagination)
// over every entry the viewer is allowed to see. Rows open a read-only flyout,
// and "Open full entry" opens a larger editable workspace scoped to that
// author's journals — both client-state driven (see _records-table.tsx), so
// opening/closing them never re-queries the list. Visibility is the journal read
// tier (read.all → tenant-wide, read.site → your sites + your own, read.self →
// your own only); the page is gated to managers — self-tier users go to /journals.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookText } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { countEntries, listEntries, listRecordsFacets, listTagSuggestions } from '../_data'
import { getAuthorPersonId, journalCanBrowseAll, journalScopeWhere } from '../_lib'
import type { JournalDefinition, JournalFilters, JournalSort, JournalStatus } from '../_types'
import { JournalRecordsTable } from './_records-table'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal records' }

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

export default async function JournalRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) redirect('/journals')

  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const filters: JournalFilters = {
    q: params.q,
    status: pickString(sp.status) as JournalStatus | undefined,
    definition: pickString(sp.definition) as JournalDefinition | undefined,
    site: pickString(sp.site),
    person: pickString(sp.person),
    tag: pickString(sp.tag),
    from: pickString(sp.from),
    to: pickString(sp.to),
  }
  const fromRaw = filters.from ?? ''
  const toRaw = filters.to ?? ''

  const scope = journalScopeWhere(ctx, await getAuthorPersonId(ctx))
  const [items, total, facets, tags] = await Promise.all([
    listEntries(ctx, filters, {
      limit: params.perPage,
      offset: (params.page - 1) * params.perPage,
      sort: params.sort,
      dir: params.dir,
    }),
    countEntries(ctx, filters),
    listRecordsFacets(ctx),
    listTagSuggestions(ctx, scope),
  ])

  const tagColors = Object.fromEntries(tags.map((t) => [t.name, t.color]))
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
            title="Journal records"
            description="Browse, filter and read every journal you have access to."
            actions={
              <Link href={buildExportHref('/journals/export.csv', sp)}>
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <ModuleNav moduleKey="journals" active="records" />
          <TableToolbar>
            <SearchInput placeholder="Search journals…" />
            <FilterChips
              basePath="/journals/records"
              currentParams={sp}
              paramKey="status"
              label="Status"
              allLabel="Any status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: facets.statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/journals/records"
              currentParams={sp}
              paramKey="definition"
              label="Type"
              allLabel="Any type"
              options={TYPE_OPTIONS}
            />
            {facets.people.length > 0 ? (
              <FilterChips
                basePath="/journals/records"
                currentParams={sp}
                paramKey="person"
                label="Author"
                allLabel="All authors"
                options={facets.people.map((p) => ({ value: p.id, label: p.name, count: p.count }))}
              />
            ) : null}
            {facets.sites.length > 0 ? (
              <FilterChips
                basePath="/journals/records"
                currentParams={sp}
                paramKey="site"
                label="Site"
                allLabel="All sites"
                options={facets.sites.map((s) => ({ value: s.id, label: s.name, count: s.count }))}
              />
            ) : null}
            {tags.length > 0 ? (
              <FilterChips
                basePath="/journals/records"
                currentParams={sp}
                paramKey="tag"
                label="Tag"
                allLabel="Any tag"
                options={tags.slice(0, 12).map((t) => ({ value: t.name, label: t.name }))}
              />
            ) : null}
            <form method="get" className="flex items-center gap-1 text-xs">
              {Object.entries({
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
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                From
                <input
                  type="date"
                  name="from"
                  defaultValue={fromRaw}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                to
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
                Apply
              </button>
            </form>
          </TableToolbar>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<BookText size={32} />}
          title={params.q ? `No journals match "${params.q}"` : 'No journals found'}
          description="Try adjusting your filters or date range."
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
      )}
    </ListPageLayout>
  )
}
