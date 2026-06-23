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
import { FormsKindNav } from './_nav'
import { AiGenerateButton } from './_ai-generate-button'
import { appVisibleTo, getUserRoleKeys } from './_lib/access'

export const metadata = { title: 'Builder' }

// Tailwind classes per app kind (badge on each card; 'form' is the default and
// not badged to keep the grid quiet).
const KIND_BADGE: Record<string, string> = {
  wizard: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  checklist: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  register: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  mini_app: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
}

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const kindFilter = pickString(sp.kind) ?? ''
  const q = pickString(sp.q) ?? ''
  const ctx = await requireRequestContext()
  const canCreate = can(ctx, 'forms.template.create')
  const canGenerate = can(ctx, 'forms.ai.generate')

  const userRoleKeys = await getUserRoleKeys(ctx)
  const {
    templates: allTemplates,
    counts,
    stats,
  } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(formTemplates.deletedAt)]
    if (kindFilter) filters.push(eq(formTemplates.kind, kindFilter as any))
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

    return {
      templates,
      counts: new Map(countRows.map((r) => [r.templateId, { c: Number(r.c), last: r.last }])),
      stats: {
        templates: Number(tot?.c ?? 0),
        published: Number(pub?.c ?? 0),
        responses: Number(resp?.c ?? 0),
      },
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
              <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Your Apps — forms, wizards, checklists, registers, and mini-apps. Build with the
                drag-drop designer, automate with Flows, then fill, review, and pin the ones your
                crews use most to the sidebar.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  <strong className="text-slate-800 dark:text-slate-200">{stats.templates}</strong>{' '}
                  templates
                </span>
                <span>
                  <strong className="text-slate-800 dark:text-slate-200">{stats.published}</strong>{' '}
                  published
                </span>
                <span>
                  <strong className="text-slate-800 dark:text-slate-200">{stats.responses}</strong>{' '}
                  responses
                </span>
                <Link href="/apps/responses" className="text-teal-700 hover:underline">
                  Browse responses →
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canGenerate ? <AiGenerateButton /> : null}
              {canCreate ? (
                <Link href="/apps/templates/new">
                  <Button>
                    <Plus size={15} /> New app
                  </Button>
                </Link>
              ) : null}
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2">
            <FormsKindNav active={kindFilter} q={q} />
            <div className="ml-auto w-full sm:w-72">
              <SearchInput placeholder="Search apps…" />
            </div>
          </div>
        </>
      }
    >
      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title={q || kindFilter ? 'No matching apps' : 'No apps yet'}
          description="Build a form, wizard, checklist, register, or mini-app with the designer."
          action={
            canCreate ? (
              <Link href="/apps/templates/new">
                <Button>Create app</Button>
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
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900">
                    <NavIcon iconKey={t.iconKey ?? 'clipboard-check'} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/apps/templates/${t.id}`}
                      className="block truncate font-semibold text-slate-900 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-400"
                    >
                      {t.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge variant={t.status === 'published' ? 'success' : 'secondary'}>
                        {t.status}
                      </Badge>
                      {t.kind && t.kind !== 'form' ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${KIND_BADGE[t.kind] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                        >
                          {t.kind === 'mini_app' ? 'mini-app' : t.kind}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {t.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                    {t.description}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                  <span>
                    {responseCount} response{responseCount === 1 ? '' : 's'}
                  </span>
                  {last ? <span>· last {new Date(last).toLocaleDateString()}</span> : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Link href={`/apps/templates/${t.id}/fill`}>
                    <Button size="sm">Fill</Button>
                  </Link>
                  {canCreate ? (
                    <Link href={`/apps/templates/${t.id}/designer`}>
                      <Button size="sm" variant="outline">
                        <PencilRuler size={14} /> Design
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
