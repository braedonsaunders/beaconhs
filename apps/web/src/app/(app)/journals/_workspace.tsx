'use client'

// The Journals workspace shell: a responsive 2-pane app (tree · editor). On
// desktop the tree sits beside the editor; on mobile the tree is a slide-over
// drawer and the editor is full-screen.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NotebookPen, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { SidebarTree } from './_sidebar-tree'
import { EditorPane } from './_editor-pane'
import {
  createEntryForDate,
  createTodayEntry,
  fetchEntry,
  fetchTree,
  fetchWorkspace,
} from './_actions'
import type { GroupBy, JournalEntryDetail, JournalFilters, WorkspaceData } from './_types'

export function JournalWorkspace({
  initialData,
  initialEntry,
  initialGroupBy,
}: {
  initialData: WorkspaceData
  initialEntry: JournalEntryDetail | null
  initialGroupBy: GroupBy
}) {
  const [data, setData] = useState(initialData)
  const [entry, setEntry] = useState(initialEntry)
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy)
  const [filters, setFilters] = useState<JournalFilters>({})
  const [treeOpen, setTreeOpen] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const [, startNav] = useTransition()
  const filtersKey = JSON.stringify(filters)

  const setUrl = useCallback((id: string | null) => {
    if (typeof window === 'undefined') return
    window.history.replaceState(null, '', id ? `/journals/${id}` : '/journals')
  }, [])

  const reloadSidebar = useCallback(async () => {
    setData(await fetchWorkspace({ groupBy, filters }))
  }, [groupBy, filters])

  // Refetch the tree/sidebar whenever filters change (skip the first render).
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    void reloadSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  // Esc closes the mobile Browse flyout.
  useEffect(() => {
    if (!treeOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTreeOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [treeOpen])

  async function selectEntry(id: string) {
    setTreeOpen(false)
    if (id === entry?.id) return
    const detail = await fetchEntry(id)
    if (detail) {
      setEntry(detail)
      setUrl(id)
    } else {
      toast.error('That entry could not be opened.')
    }
  }

  async function changeGroupBy(g: GroupBy) {
    setGroupBy(g)
    setTreeLoading(true)
    try {
      const tree = await fetchTree({ groupBy: g, filters })
      setData((d) => ({ ...d, tree }))
    } finally {
      setTreeLoading(false)
    }
  }

  function changeFilters(partial: Partial<JournalFilters>) {
    setFilters((f) => ({ ...f, ...partial }))
  }

  function newEntry() {
    startNav(async () => {
      const r = await createTodayEntry()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      await openCreated(r.id)
    })
  }

  function pickDate(dateISO: string) {
    startNav(async () => {
      const r = await createEntryForDate(dateISO)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      await openCreated(r.id)
    })
  }

  async function openCreated(id: string) {
    const detail = await fetchEntry(id)
    if (detail) {
      setEntry(detail)
      setUrl(id)
      setTreeOpen(false)
    }
    void reloadSidebar()
  }

  async function onMutated() {
    await reloadSidebar()
  }

  function onDeleted() {
    setEntry(null)
    setUrl(null)
    void reloadSidebar()
  }

  function onLocalPatch(patch: Partial<JournalEntryDetail>) {
    setEntry((e) => (e ? { ...e, ...patch } : e))
  }

  const sidebar = (
    <SidebarTree
      data={data}
      groupBy={groupBy}
      filters={filters}
      selectedId={entry?.id ?? null}
      loading={treeLoading}
      onGroupByChange={changeGroupBy}
      onFiltersChange={changeFilters}
      onSelect={selectEntry}
      onNewEntry={newEntry}
      onPickDate={pickDate}
    />
  )

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-slate-50/40">
      {/* Tree — desktop column */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 lg:block">{sidebar}</aside>

      {/* Tree — mobile Browse flyout: right-side, animated (matches app drawers) */}
      <AnimatePresence>
        {treeOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              onClick={() => setTreeOpen(false)}
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.8 }}
              className="absolute top-0 right-0 h-full w-[88%] max-w-xs border-l border-slate-200 bg-white shadow-2xl"
            >
              {sidebar}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — quick new + Browse flyout (right) */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 lg:hidden">
          <span className="text-sm font-semibold text-slate-800">Journal</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={newEntry}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-teal-700 px-2.5 text-xs font-medium text-white hover:bg-teal-800"
            >
              <Plus size={14} /> New
            </button>
            <button
              type="button"
              onClick={() => setTreeOpen(true)}
              aria-label="Browse journals"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <NotebookPen size={15} /> Browse
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {entry ? (
            <EditorPane
              entry={entry}
              sites={data.sites}
              people={data.people}
              tagSuggestions={data.tagSuggestions}
              aiEnabled={data.aiEnabled}
              onMutated={onMutated}
              onDeleted={onDeleted}
              onLocalPatch={onLocalPatch}
            />
          ) : (
            <EmptyEditor aiEnabled={data.aiEnabled} onNew={newEntry} />
          )}
        </div>
      </main>
    </div>
  )
}

function EmptyEditor({ aiEnabled, onNew }: { aiEnabled: boolean; onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-teal-50 text-teal-600">
        <NotebookPen size={30} />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Start today’s journal</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Capture what you worked on, hazards you spotted, and what got done. Add photos, dictate by
        voice{aiEnabled ? ', and let AI tidy it up, tag it, and flag safety concerns.' : '.'}
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
      >
        <Plus size={16} /> New entry
      </button>
      {aiEnabled ? (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Sparkles size={12} className="text-teal-500" /> AI assist is on
        </div>
      ) : null}
    </div>
  )
}
