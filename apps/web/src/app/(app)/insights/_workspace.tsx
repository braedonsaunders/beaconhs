'use client'

// The Insights workspace: a tab bar of named dashboards (add/rename/delete),
// each a customisable widget grid. View mode is locked; Customise unlocks
// drag / resize / add / remove + Save.

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { Loader2, Plus, Save, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, cn } from '@beaconhs/ui'
import { InsightsGrid } from './_grid'
import { WidgetView } from './_widget-view'
import { INSIGHT_WIDGETS } from './_widgets'
import { createDashboard, deleteDashboard, renameDashboard, saveDashboardLayout } from './_actions'
import type { InsightDashboardRow, InsightsData } from './_data'

type Board = { id: string; name: string; widgets: InsightDashboardRow['layout']['widgets'] }

export function InsightsWorkspace({
  initialDashboards,
  data,
}: {
  initialDashboards: InsightDashboardRow[]
  data: InsightsData
}) {
  const [boards, setBoards] = useState<Board[]>(
    initialDashboards.map((d) => ({ id: d.id, name: d.name, widgets: d.layout.widgets })),
  )
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(true)
  const [saving, startSave] = useTransition()
  const [, startBusy] = useTransition()
  const baselines = useRef<Record<string, string>>(
    Object.fromEntries(boards.map((b) => [b.id, JSON.stringify(b.widgets)])),
  )

  const active = boards.find((b) => b.id === activeId) ?? null
  const dirty = active ? JSON.stringify(active.widgets) !== baselines.current[active.id] : false

  const nodes = useMemo(() => {
    const r: Record<string, ReactNode> = {}
    for (const w of INSIGHT_WIDGETS) r[w.id] = <WidgetView id={w.id} data={data} />
    return r
  }, [data])

  function setActiveWidgets(widgets: Board['widgets']) {
    setBoards((bs) => bs.map((b) => (b.id === activeId ? { ...b, widgets } : b)))
  }

  function switchTab(id: string) {
    if (id === activeId) return
    if (editing && dirty && active) {
      if (!window.confirm('Discard unsaved changes to this dashboard?')) return
      const base = baselines.current[active.id]
      setBoards((bs) => bs.map((b) => (b.id === active.id ? { ...b, widgets: base ? JSON.parse(base) : [] } : b)))
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
        baselines.current[active.id] = JSON.stringify(active.widgets)
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
      setBoards((bs) => [...bs, { id: r.id, name: 'New dashboard', widgets: [] }])
      baselines.current[r.id] = JSON.stringify([])
      setActiveId(r.id)
      setEditing(true)
      setPaletteOpen(true)
    })
  }

  function renameLocal(name: string) {
    if (!active) return
    setBoards((bs) => bs.map((b) => (b.id === active.id ? { ...b, name } : b)))
  }
  function persistName() {
    if (!active) return
    void renameDashboard(active.id, active.name)
  }

  function del() {
    if (!active) return
    if (!window.confirm(`Delete dashboard “${active.name}”? This cannot be undone.`)) return
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
      delete baselines.current[id]
      setEditing(false)
      toast.success('Dashboard deleted')
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/40">
      {/* Tabs */}
      <div className="flex items-end gap-1 border-b border-slate-200 bg-white px-3 pt-2">
        <div className="app-scroll flex flex-1 items-end gap-1 overflow-x-auto">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => switchTab(b.id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                b.id === activeId
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {b.name}
            </button>
          ))}
          <button
            type="button"
            onClick={addDashboard}
            title="New dashboard"
            className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        {editing && active ? (
          <>
            <input
              value={active.name}
              onChange={(e) => renameLocal(e.target.value)}
              onBlur={persistName}
              className="h-8 rounded-md border border-slate-300 px-2.5 text-sm font-medium outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25"
            />
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setPaletteOpen((v) => !v)} className="h-8 text-xs">
                <Plus size={13} className="mr-1" /> {paletteOpen ? 'Hide widgets' : 'Add widgets'}
              </Button>
              <Button type="button" variant="ghost" onClick={del} className="h-8 text-xs text-rose-700 hover:bg-rose-50">
                <Trash2 size={13} className="mr-1" /> Delete
              </Button>
              <Button type="button" onClick={save} disabled={saving || !dirty} className="h-8 text-xs">
                {saving ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Save size={13} className="mr-1" />}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (dirty && active && !window.confirm('Discard unsaved changes?')) return
                  if (dirty && active) {
                    const base = baselines.current[active.id]
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
            <span className="text-sm font-semibold text-slate-800">{active?.name ?? 'Insights'}</span>
            <div className="ml-auto">
              <Button
                type="button"
                onClick={() => {
                  setEditing(true)
                  setPaletteOpen(true)
                }}
                disabled={!active}
                className="h-8 text-xs"
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
          <InsightsGrid
            widgets={active.widgets}
            nodes={nodes}
            editing={editing}
            paletteOpen={paletteOpen}
            onChange={setActiveWidgets}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <p className="mb-3 text-sm text-slate-500">No dashboards yet.</p>
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
