import Link from 'next/link'
import { ClipboardCheck, PencilRuler, Plus } from 'lucide-react'
import { and, count, desc, eq, ilike, isNull, max, type SQL } from 'drizzle-orm'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import { formResponses, formTemplates } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { NavIcon } from '@/components/sidebar-nav'
import { pickString } from '@/lib/list-params'
import { loadNavConfig } from '@/lib/nav/resolve'
import { PinFormButton } from './_pin-button'
import { AiGenerateButton } from './_ai-generate-button'
import { appVisibleTo, getUserRoleKeys } from './_lib/access'

export const metadata = { title: 'Forms' }

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'jsha', label: 'JSHA' },
  { value: 'toolbox_talk', label: 'Toolbox talk' },
  { value: 'lift_plan', label: 'Lift plan' },
  { value: 'wah', label: 'WAH rescue' },
  { value: 'incident_investigation', label: 'Incident investigation' },
  { value: 'custom', label: 'Custom' },
] as const

// A template's icon: explicit override, else a sensible per-category default.
// Tailwind classes per app kind (badge on each card; 'form' is the default and
// not badged to keep the grid quiet).
const KIND_BADGE: Record<string, string> = {
  wizard: 'bg-indigo-50 text-indigo-700',
  checklist: 'bg-emerald-50 text-emerald-700',
  register: 'bg-amber-50 text-amber-700',
  mini_app: 'bg-violet-50 text-violet-700',
}

function iconKeyForTemplate(iconKey: string | null, category: string | null): string {
  if (iconKey) return iconKey
  switch (category) {
    case 'inspection':
      return 'clipboard'
    case 'jsha':
      return 'radiation'
    case 'toolbox_talk':
      return 'message'
    case 'incident_investigation':
      return 'alert'
    case 'lift_plan':
      return 'construction'
    case 'wah':
      return 'shield'
    default:
      return 'clipboard-check'
  }
}

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const categoryFilter = pickString(sp.category) ?? ''
  const q = pickString(sp.q) ?? ''
  const ctx = await requireRequestContext()
  const canCreate = can(ctx, 'forms.template.create')
  const canPin = can(ctx, 'admin.nav.manage')
  const canGenerate = can(ctx, 'forms.ai.generate')

  const userRoleKeys = await getUserRoleKeys(ctx)
  const { templates: allTemplates, counts, stats, pinnedIds } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(formTemplates.deletedAt)]
    if (categoryFilter) filters.push(eq(formTemplates.category, categoryFilter))
    if (q) filters.push(ilike(formTemplates.name, `%${q}%`))

    const templates = await tx
      .select()
      .from(formTemplates)
      .where(and(...filters))
      .orderBy(desc(formTemplates.updatedAt))
      .limit(200)

    const countRows = await tx
      .select({
        templateId: formResponses.templateId,
        c: count(),
        last: max(formResponses.submittedAt),
      })
      .from(formResponses)
      .groupBy(formResponses.templateId)

    const [tot] = await tx
      .select({ c: count() })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt))
    const [pub] = await tx
      .select({ c: count() })
      .from(formTemplates)
      .where(and(isNull(formTemplates.deletedAt), eq(formTemplates.status, 'published')))
    const [resp] = await tx.select({ c: count() }).from(formResponses)

    // Which templates are currently pinned to the sidebar (admins only — drives
    // the Pin/Unpin toggle on each card).
    const pinnedIds = canPin
      ? (await loadNavConfig(tx)).groups
          .flatMap((g) => g.items)
          .reduce((acc, i) => {
            if (i.kind === 'form') acc.add(i.templateId)
            return acc
          }, new Set<string>())
      : new Set<string>()

    return {
      templates,
      counts: new Map(countRows.map((r) => [r.templateId, { c: Number(r.c), last: r.last }])),
      stats: {
        templates: Number(tot?.c ?? 0),
        published: Number(pub?.c ?? 0),
        responses: Number(resp?.c ?? 0),
      },
      pinnedIds,
    }
  })

  // App-level role gating — hide apps this viewer's roles can't access.
  const templates = allTemplates.filter((t) => appVisibleTo(ctx, t.allowedRoles, userRoleKeys))

  return (
    <ListPageLayout
      header={
        <>
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">Builder</h1>
              <p className="max-w-2xl text-sm text-slate-500">
                Your Apps — forms, wizards, inspections, checklists, toolbox talks, lift plans,
                anything. Build with the drag-drop designer, automate with Flows, then fill, review,
                and pin the ones your crews use most to the sidebar.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500">
                <span><strong className="text-slate-800">{stats.templates}</strong> templates</span>
                <span><strong className="text-slate-800">{stats.published}</strong> published</span>
                <span><strong className="text-slate-800">{stats.responses}</strong> responses</span>
                <Link href="/forms/responses" className="text-teal-700 hover:underline">
                  Browse responses →
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canGenerate ? <AiGenerateButton /> : null}
              {canCreate ? (
                <Link href="/forms/templates/new">
                  <Button>
                    <Plus size={15} /> New app
                  </Button>
                </Link>
              ) : null}
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2">
            {CATEGORY_FILTERS.map((c) => {
              const active = c.value === categoryFilter
              const params = new URLSearchParams()
              if (c.value) params.set('category', c.value)
              if (q) params.set('q', q)
              const href = params.toString() ? `/forms?${params.toString()}` : '/forms'
              return (
                <Link
                  key={c.value || 'all'}
                  href={href as any}
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
            <div className="ml-auto w-full sm:w-64">
              <SearchInput placeholder="Search forms…" />
            </div>
          </div>
        </>
      }
    >
      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title={q || categoryFilter ? 'No matching forms' : 'No form templates yet'}
          description="Build your first template — inspection, JSHA, toolbox talk, anything."
          action={
            canCreate ? (
              <Link
                href={
                  categoryFilter
                    ? `/forms/templates/new?category=${categoryFilter}`
                    : '/forms/templates/new'
                }
              >
                <Button>Create template</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const stat = counts.get(t.id)
            const responseCount = stat?.c ?? 0
            const last = stat?.last ?? null
            return (
              <div
                key={t.id}
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                    <NavIcon iconKey={iconKeyForTemplate(t.iconKey, t.category)} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/forms/templates/${t.id}`}
                      className="block truncate font-semibold text-slate-900 hover:text-teal-700"
                    >
                      {t.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge variant={t.status === 'published' ? 'success' : 'secondary'}>
                        {t.status}
                      </Badge>
                      {t.kind && t.kind !== 'form' ? (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_BADGE[t.kind] ?? 'bg-slate-100 text-slate-600'}`}>
                          {t.kind === 'mini_app' ? 'mini-app' : t.kind}
                        </span>
                      ) : null}
                      <span>{t.category ?? 'general'}</span>
                    </div>
                  </div>
                </div>

                {t.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500">{t.description}</p>
                ) : null}

                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <span>
                    {responseCount} response{responseCount === 1 ? '' : 's'}
                  </span>
                  {last ? <span>· last {new Date(last).toLocaleDateString()}</span> : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Link href={`/forms/templates/${t.id}/fill`}>
                    <Button size="sm">Fill</Button>
                  </Link>
                  {canCreate ? (
                    <Link href={`/forms/templates/${t.id}/designer`}>
                      <Button size="sm" variant="outline">
                        <PencilRuler size={14} /> Design
                      </Button>
                    </Link>
                  ) : null}
                  {canPin ? <PinFormButton templateId={t.id} pinned={pinnedIds.has(t.id)} /> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
