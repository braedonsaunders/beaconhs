import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import { formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'

export const metadata = { title: 'Forms' }

const CATEGORY_FILTERS = [
  { value: '', label: 'All categories' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'jsha', label: 'JSHA' },
  { value: 'toolbox_talk', label: 'Toolbox talk' },
  { value: 'incident_investigation', label: 'Incident investigation' },
  { value: 'custom', label: 'Custom' },
] as const

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const categoryFilter = pickString(sp.category) ?? ''
  const ctx = await requireRequestContext()

  const templates = await ctx.db((tx) => {
    const filters: SQL<unknown>[] = []
    if (categoryFilter) filters.push(eq(formTemplates.category, categoryFilter))
    const where = filters.length > 0 ? and(...filters) : undefined
    return tx
      .select()
      .from(formTemplates)
      .where(where)
      .orderBy(desc(formTemplates.updatedAt))
      .limit(100)
  })

  return (
    <ListPageLayout
      header={
        <>
          <header className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Forms</h1>
              <p className="text-sm text-slate-500">
                Templates, assignments, and submissions. Drag-drop designer + visual logic builder.
              </p>
            </div>
            <Link href="/forms/templates/new">
              <Button>New template</Button>
            </Link>
          </header>
          <nav className="flex flex-wrap items-center gap-2">
            {CATEGORY_FILTERS.map((c) => {
              const active = c.value === categoryFilter
              const href = c.value ? `/forms?category=${c.value}` : '/forms'
              return (
                <Link
                  key={c.value || 'all'}
                  href={href}
                  className={
                    active
                      ? 'rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700'
                      : 'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700'
                  }
                >
                  {c.label}
                </Link>
              )
            })}
            <span className="ml-auto text-xs text-slate-500">
              <Link href="/forms/responses" className="hover:text-teal-700 hover:underline">
                Browse responses →
              </Link>
            </span>
          </nav>
        </>
      }
    >
      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title={categoryFilter ? `No "${categoryFilter}" templates yet` : 'No form templates yet'}
          description="Build your first template — inspection, JSHA, toolbox talk, anything."
          action={
            <Link
              href={
                categoryFilter
                  ? `/forms/templates/new?category=${categoryFilter}`
                  : '/forms/templates/new'
              }
            >
              <Button>Create template</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-4">
              <div className="space-y-1">
                <Link href={`/forms/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{t.category ?? 'general'}</span>
                  <Badge variant={t.status === 'published' ? 'success' : 'secondary'}>
                    {t.status}
                  </Badge>
                </div>
              </div>
              <Link href={`/forms/templates/${t.id}`}>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListPageLayout>
  )
}
