// Report library — every report this tenant can run: the built-in catalogue
// plus the tenant's custom definitions, as a searchable, filterable card grid
// grouped by category.

import Link from 'next/link'
import { Badge, Button, EmptyState, Input, PageHeader } from '@beaconhs/ui'
import { BarChart3, Plus, Search } from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { loadVisibleDefinitions, type ReportDefinitionRow } from '../_definitions'
import { ReportsSubNav } from '../_nav'

export const metadata = { title: 'Report library' }
export const dynamic = 'force-dynamic'

export default async function ReportLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const kind = typeof sp.kind === 'string' ? sp.kind : undefined
  const category = typeof sp.category === 'string' ? sp.category : undefined
  const q = typeof sp.q === 'string' ? sp.q.trim().toLowerCase() : ''

  const all = await loadVisibleDefinitions(ctx.tenantId!)

  const categories = [...new Set(all.map((d) => d.category).filter(Boolean))] as string[]
  categories.sort()

  const filtered = all.filter((d) => {
    if (kind && d.kind !== kind) return false
    if (category && d.category !== category) return false
    if (q && !`${d.name} ${d.description ?? ''}`.toLowerCase().includes(q)) return false
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

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Report library"
            description="Built-in and custom reports. Run, export, or schedule email delivery."
            actions={
              <Link href={'/reports/definitions/new' as never}>
                <Button>
                  <Plus size={14} className="mr-1.5" />
                  New custom report
                </Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="library" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <form method="get" className="relative">
                {kind ? <input type="hidden" name="kind" value={kind} /> : null}
                {category ? <input type="hidden" name="category" value={category} /> : null}
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
                />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Search reports…"
                  className="h-8 w-56 pl-8"
                />
              </form>
              <FilterChips
                basePath="/reports/definitions"
                currentParams={sp}
                paramKey="kind"
                label="Kind"
                options={[
                  { value: 'built_in', label: 'Built-in' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              <FilterChips
                basePath="/reports/definitions"
                currentParams={sp}
                paramKey="category"
                label="Category"
                options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
              />
            </div>
          </div>
        </>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={28} />}
          title={all.length === 0 ? 'No reports available' : 'No matching reports'}
          description={
            all.length === 0
              ? 'Create a custom report to get started.'
              : 'Adjust the search or filters.'
          }
          action={
            <Link href={'/reports/definitions/new' as never}>
              <Button variant="outline">Build a custom report</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {sections.map(([cat, defs]) => (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                {cat.replace(/_/g, ' ')}{' '}
                <span className="font-normal text-slate-400">({defs.length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {defs.map((d) => (
                  <DefinitionCard key={d.id} definition={d} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ListPageLayout>
  )
}

function DefinitionCard({ definition: d }: { definition: ReportDefinitionRow }) {
  return (
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/reports/definitions/${d.id}` as never}
          className="font-medium text-slate-900 group-hover:text-teal-700 hover:underline dark:text-slate-100 dark:group-hover:text-teal-300"
        >
          {d.name}
        </Link>
        {d.kind === 'custom' ? <Badge variant="secondary">custom</Badge> : null}
      </div>
      <p className="mt-1 line-clamp-2 flex-1 text-xs text-slate-500 dark:text-slate-400">
        {d.description ?? 'No description.'}
      </p>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link href={`/reports/definitions/${d.id}` as never}>
          <Button variant="outline" size="sm">
            View
          </Button>
        </Link>
        <Link href={`/reports/schedules/new?definitionId=${d.id}`}>
          <Button variant="ghost" size="sm">
            Subscribe
          </Button>
        </Link>
      </div>
    </div>
  )
}
