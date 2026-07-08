// Reports hub — a fit-to-viewport master-detail split. LEFT: the searchable,
// filterable catalogue of every report (built-in + custom, grouped by
// category). RIGHT: a live paginated print preview of the selected report
// (?selected=), or the module overview (stats / schedules / deliveries) when
// nothing is selected. The old Library tab merged into this page.

import Link from 'next/link'
import { Suspense } from 'react'
import { Button, PageHeader, Skeleton, cn } from '@beaconhs/ui'
import { Plus, Sparkles } from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { FadeInHeader } from '@/components/page-layout-motion'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { loadVisibleDefinitions, type ReportDefinitionRow } from './_definitions'
import { ReportsSubNav } from './_nav'
import { DefinitionList } from './_hub/definition-list'
import { PreviewPane } from './_hub/preview-pane'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const kind = typeof sp.kind === 'string' ? sp.kind : undefined
  const category = typeof sp.category === 'string' ? sp.category : undefined
  const q = typeof sp.q === 'string' ? sp.q.trim() : ''
  const selected = typeof sp.selected === 'string' ? sp.selected : null

  const all = await loadVisibleDefinitions(ctx.tenantId!)
  const selectedDef = selected ? (all.find((d) => d.id === selected) ?? null) : null

  const categories = [...new Set(all.map((d) => d.category).filter(Boolean))] as string[]
  categories.sort()

  const needle = q.toLowerCase()
  const filtered = all.filter((d) => {
    if (kind && d.kind !== kind) return false
    if (category && d.category !== category) return false
    if (needle && !`${d.name} ${d.description ?? ''}`.toLowerCase().includes(needle)) return false
    return true
  })

  const byCategory = new Map<string, ReportDefinitionRow[]>()
  for (const d of filtered) {
    const k = d.category ?? 'other'
    const list = byCategory.get(k) ?? []
    list.push(d)
    byCategory.set(k, list)
  }
  const sections = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))

  const listParams = { q: q || undefined, kind, category }
  const counts = {
    builtIn: all.filter((d) => d.kind === 'built_in').length,
    custom: all.filter((d) => d.kind === 'custom').length,
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white px-3 pt-3 pb-2.5 sm:px-6 sm:pt-4 sm:pb-3 dark:border-slate-800 dark:bg-slate-900">
        <FadeInHeader className="mx-auto max-w-screen-2xl space-y-2 sm:space-y-2.5">
          <PageHeader
            title="Reports"
            description="Print-ready documents from your records — preview, export, and schedule PDF delivery."
            actions={
              <div className="flex gap-2">
                <Link href={'/reports/definitions/new' as never}>
                  <Button variant="outline">
                    <Sparkles size={14} className="mr-1.5" />
                    New report
                  </Button>
                </Link>
                <Link href="/reports/schedules/new">
                  <Button>
                    <Plus size={14} className="mr-1.5" />
                    New schedule
                  </Button>
                </Link>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="reports" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SearchInput placeholder="Search reports…" />
              <FilterChips
                basePath="/reports"
                currentParams={sp}
                paramKey="kind"
                label="Kind"
                options={[
                  { value: 'built_in', label: 'Built-in' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              <FilterChips
                basePath="/reports"
                currentParams={sp}
                paramKey="category"
                label="Category"
                options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
              />
            </div>
          </div>
        </FadeInHeader>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            'app-scroll min-h-0 w-full overflow-y-auto border-slate-200 bg-white md:block md:w-1/3 md:max-w-md md:min-w-[300px] md:shrink-0 md:border-r dark:border-slate-800 dark:bg-slate-900',
            selectedDef ? 'hidden' : 'block',
          )}
        >
          <DefinitionList
            sections={sections}
            selectedId={selectedDef?.id ?? null}
            listParams={listParams}
            totalAll={all.length}
          />
        </aside>
        <section
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950',
            selectedDef ? 'flex' : 'hidden md:flex',
          )}
        >
          <Suspense key={selectedDef?.id ?? 'overview'} fallback={<PreviewSkeleton />}>
            <PreviewPane
              ctx={ctx}
              definition={selectedDef}
              listParams={listParams}
              counts={counts}
            />
          </Suspense>
        </section>
      </div>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="mx-auto h-[70vh] w-full max-w-3xl" />
    </div>
  )
}
