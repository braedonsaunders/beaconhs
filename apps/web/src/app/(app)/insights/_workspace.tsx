'use client'

// The Insights workspace: a tab bar of dashboards (the user's own), each a
// customisable grid of built-in widgets AND saved Cards. View mode is locked;
// Customise unlocks drag / resize / add / remove + Save.

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Library, Loader2, Plus, Save, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, cn } from '@beaconhs/ui'
import { vizDef, type AnalyticsEntity } from '@beaconhs/analytics'
import type { DashboardParam, DashboardParamMap } from '@beaconhs/db/schema'
import { InsightsGrid, type GridItem } from './_grid'
import { DashboardFilters, type ParamCard } from './_filter-bar.client'
import { JournalAnalysisWidget } from './_ai-widget'
import { CardCell } from './_viz/card-cell.client'
import { PublishControl, type PublishRoleOption } from './_publish-control.client'
import { BESPOKE_INSIGHT_WIDGETS, INSIGHT_CATEGORY_LABELS } from './_widgets'
import {
  createDashboard,
  deleteDashboard,
  publishDashboard,
  renameDashboard,
  saveDashboardLayout,
  saveDashboardParams,
  unpublishDashboard,
} from './_actions'
import type { CardRender, InsightDashboardRow } from './_data'
import type { CardRow } from './cards/_data'
import { confirmDialog } from '@/lib/confirm'

type Board = {
  id: string
  name: string
  widgets: InsightDashboardRow['layout']['widgets']
  params: DashboardParam[]
  paramMap: DashboardParamMap
  owned: boolean
  status: 'draft' | 'published'
  allowedRoles: string[] | null
}

export function InsightsWorkspace({
  initialDashboards,
  aiEnabled,
  paletteCards,
  cardRenders,
  canCreate,
  canPublish,
  roles,
  entities,
}: {
  initialDashboards: InsightDashboardRow[]
  aiEnabled: boolean
  paletteCards: CardRow[]
  cardRenders: Record<string, CardRender>
  canCreate: boolean
  canPublish: boolean
  roles: PublishRoleOption[]
  entities: AnalyticsEntity[]
}) {
  const router = useRouter()
  const [boards, setBoards] = useState<Board[]>(
    initialDashboards.map((d) => ({
      id: d.id,
      name: d.name,
      widgets: d.layout.widgets,
      params: d.params,
      paramMap: d.paramMap,
      owned: d.owned,
      status: d.status,
      allowedRoles: d.allowedRoles,
    })),
  )
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(true)
  const [saving, startSave] = useTransition()
  const [busy, startBusy] = useTransition()
  const [baselines, setBaselines] = useState<Record<string, string>>(() =>
    Object.fromEntries(boards.map((b) => [b.id, JSON.stringify(b.widgets)])),
  )

  const active = boards.find((b) => b.id === activeId) ?? null
  const dirty = active ? JSON.stringify(active.widgets) !== baselines[active.id] : false

  // Card renders are keyed by `${dashboardId}:${cardId}` so each board sees its
  // own params applied. Resolve the active board's cards into the node map; the
  // AI journal analysis is the one remaining bespoke (non-card) widget.
  const nodes = useMemo(() => {
    const r: Record<string, ReactNode> = {
      'ai-analysis': <JournalAnalysisWidget aiEnabled={aiEnabled} />,
    }
    if (active) {
      for (const w of active.widgets) {
        const render = cardRenders[`${active.id}:${w.id}`]
        if (render) r[w.id] = <CardCell render={render} />
      }
    }
    return r
  }, [aiEnabled, cardRenders, active])

  // The cards currently placed on the active board + their entity columns — the
  // targets the filter-settings drawer maps params onto.
  const cardsById = useMemo(() => new Map(paletteCards.map((c) => [c.id, c])), [paletteCards])
  const entityMap = useMemo(() => Object.fromEntries(entities.map((e) => [e.key, e])), [entities])
  const paramCards = useMemo<ParamCard[]>(() => {
    if (!active) return []
    const seen = new Set<string>()
    const out: ParamCard[] = []
    for (const w of active.widgets) {
      const card = cardsById.get(w.id)
      if (!card || seen.has(card.id)) continue
      seen.add(card.id)
      const entityKey = card.query.stages[0]?.source ?? ''
      const columns = (entityMap[entityKey]?.columns ?? []).map((c) => ({
        key: c.key,
        label: c.label,
        semanticType: c.semanticType,
        enumOptions: c.enumOptions,
      }))
      out.push({ id: card.id, name: card.name, entityKey, columns })
    }
    return out
  }, [active, cardsById, entityMap])

  // Only widgets WITHOUT a system card appear in the widget section — every
  // BHQL built-in is already a published Card and would otherwise show twice.
  const paletteItems = useMemo<GridItem[]>(
    () => [
      ...BESPOKE_INSIGHT_WIDGETS.map((w) => ({
        id: w.id,
        label: w.label,
        description: w.description,
        category: w.category as string,
        minSize: w.minSize,
        defaultSize: w.defaultSize,
      })),
      ...paletteCards.map((c) => {
        const vd = vizDef(c.vizType)
        return {
          id: c.id,
          label: c.name,
          description: c.description ?? 'Saved card',
          category: 'cards',
          minSize: vd?.minSize ?? { w: 3, h: 3 },
          defaultSize: vd?.defaultSize ?? { w: 6, h: 4 },
        }
      }),
    ],
    [paletteCards],
  )
  const categoryLabels = useMemo(() => ({ ...INSIGHT_CATEGORY_LABELS, cards: 'Cards' }), [])

  function setActiveWidgets(widgets: Board['widgets']) {
    setBoards((bs) => bs.map((b) => (b.id === activeId ? { ...b, widgets } : b)))
  }

  async function switchTab(id: string) {
    if (id === activeId) return
    if (editing && dirty && active) {
      if (!(await confirmDialog('Discard unsaved changes to this dashboard?'))) return
      const base = baselines[active.id]
      setBoards((bs) =>
        bs.map((b) => (b.id === active.id ? { ...b, widgets: base ? JSON.parse(base) : [] } : b)),
      )
    }
    setActiveId(id)
    setEditing(false)
    setPaletteOpen(true)
  }

  function save() {
    if (!active) return
    startSave(async () => {
      const r = await saveDashboardLayout({ id: active.id, layout: { widgets: active.widgets } })
      if (r.ok) {
        setBaselines((current) => ({
          ...current,
          [active.id]: JSON.stringify(active.widgets),
        }))
        toast.success('Dashboard saved')
      } else {
        toast.error(r.error)
      }
    })
  }

  function addDashboard() {
    startBusy(async () => {
      const r = await createDashboard('New dashboard')
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setBoards((bs) => [
        ...bs,
        {
          id: r.id,
          name: 'New dashboard',
          widgets: [],
          params: [],
          paramMap: {},
          owned: true,
          status: 'draft' as const,
          allowedRoles: null,
        },
      ])
      setBaselines((current) => ({ ...current, [r.id]: JSON.stringify([]) }))
      setActiveId(r.id)
      setEditing(true)
      setPaletteOpen(true)
    })
  }

  async function saveParams(
    params: DashboardParam[],
    paramMap: DashboardParamMap,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!active) return { ok: false, error: 'No dashboard selected.' }
    const id = active.id
    const r = await saveDashboardParams({ id, params, paramMap })
    if (r.ok) {
      setBoards((bs) => bs.map((b) => (b.id === id ? { ...b, params, paramMap } : b)))
      // Recompile the board's cards with the new mappings/defaults applied.
      router.refresh()
    }
    return r
  }

  function renameLocal(name: string) {
    if (!active) return
    setBoards((bs) => bs.map((b) => (b.id === active.id ? { ...b, name } : b)))
  }
  function persistName() {
    if (!active) return
    void renameDashboard(active.id, active.name)
  }

  async function del() {
    if (!active) return
    if (
      !(await confirmDialog({
        message: `Delete dashboard “${active.name}”? This cannot be undone.`,
        tone: 'danger',
      }))
    )
      return
    const id = active.id
    startBusy(async () => {
      const r = await deleteDashboard(id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setBoards((bs) => {
        const rest = bs.filter((b) => b.id !== id)
        setActiveId(rest[0]?.id ?? null)
        return rest
      })
      setBaselines((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setEditing(false)
      toast.success('Dashboard deleted')
    })
  }

  function publish(allowedRoles: string[] | null) {
    if (!active) return
    startBusy(async () => {
      const r = await publishDashboard({ id: active.id, allowedRoles })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setBoards((bs) =>
        bs.map((b) =>
          b.id === active.id ? { ...b, status: 'published' as const, allowedRoles } : b,
        ),
      )
      toast.success('Published to library')
    })
  }

  function unpublish() {
    if (!active) return
    startBusy(async () => {
      const r = await unpublishDashboard(active.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setBoards((bs) =>
        bs.map((b) => (b.id === active.id ? { ...b, status: 'draft' as const } : b)),
      )
      toast.success('Unpublished')
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/40 dark:bg-slate-950">
      {/* Tabs */}
      <div className="flex items-end gap-1 border-b border-slate-200 bg-white px-3 pt-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="app-scroll flex flex-1 items-end gap-1 overflow-x-auto">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => switchTab(b.id)}
              className={cn(
                'shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                b.id === activeId
                  ? 'border-teal-600 text-teal-700 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {b.name}
            </button>
          ))}
          <button
            type="button"
            onClick={addDashboard}
            title="New dashboard"
            className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-0.5 pb-1">
          <Link
            href="/insights/library"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Library size={13} />
            <span className="hidden sm:inline">Library</span>
          </Link>
          {canCreate ? (
            <Link
              href="/insights/cards/new"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">New card</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        {editing && active ? (
          <>
            <input
              value={active.name}
              onChange={(e) => renameLocal(e.target.value)}
              onBlur={persistName}
              className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-sm font-medium outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 sm:max-w-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPaletteOpen((v) => !v)}
                className="h-8 text-xs"
              >
                <Plus size={13} className="mr-1" /> {paletteOpen ? 'Hide library' : 'Add content'}
              </Button>
              {canPublish ? (
                <PublishControl
                  key={active.id}
                  status={active.status}
                  roles={roles}
                  initialAllowedRoles={active.allowedRoles}
                  pending={busy}
                  onPublish={publish}
                  onUnpublish={unpublish}
                  buttonVariant="ghost"
                  buttonClassName="h-8 text-xs"
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={del}
                className="h-8 text-xs text-rose-700 hover:bg-rose-50"
              >
                <Trash2 size={13} className="mr-1" /> Delete
              </Button>
              <Button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="h-8 text-xs"
              >
                {saving ? (
                  <Loader2 size={13} className="mr-1 animate-spin" />
                ) : (
                  <Save size={13} className="mr-1" />
                )}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (dirty && active && !(await confirmDialog('Discard unsaved changes?'))) return
                  if (dirty && active) {
                    const base = baselines[active.id]
                    setActiveWidgets(base ? JSON.parse(base) : [])
                  }
                  setEditing(false)
                }}
                className="h-8 text-xs"
              >
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {active?.name ?? 'Insights'}
            </span>
            {active && !active.owned ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Pinned · view only
              </span>
            ) : null}
            <div className="ml-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(true)
                  setPaletteOpen(true)
                }}
                disabled={!active || !active.owned}
                className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400"
              >
                <Settings size={13} className="mr-1" /> Customise
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Grid */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {active ? (
          <>
            <DashboardFilters
              params={active.params}
              paramMap={active.paramMap}
              editable={editing && active.owned}
              cards={paramCards}
              onSaveParams={saveParams}
            />
            <InsightsGrid
              widgets={active.widgets}
              nodes={nodes}
              items={paletteItems}
              categoryLabels={categoryLabels}
              editing={editing}
              paletteOpen={paletteOpen}
              onChange={setActiveWidgets}
            />
          </>
        ) : (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <p className="mb-3 text-sm text-slate-500">No dashboards</p>
              <Button type="button" onClick={addDashboard}>
                <Plus size={15} className="mr-1.5" /> Create a dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
