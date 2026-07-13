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
  fetchAuthorTree,
  fetchAuthorWorkspaceData,
  fetchEntry,
  fetchTree,
  fetchWorkspace,
} from './_actions'
import type {
  AuthorRef,
  GroupBy,
  JournalEntryDetail,
  JournalFilters,
  WorkspaceData,
} from './_types'

export function JournalWorkspace({
  initialData,
  initialEntry,
  initialGroupBy,
  author = null,
}: {
  initialData: WorkspaceData
  initialEntry: JournalEntryDetail | null
  initialGroupBy: GroupBy
  /** When set, this is the records "Open full entry" flyout: the tree is scoped
   *  to this author's journals, the address bar is left alone, and create
   *  affordances are hidden. Omitted for the personal /journals workspace. */
  author?: AuthorRef | null
}) {
  const [data, setData] = useState(initialData)
  const [entry, setEntry] = useState(initialEntry)
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy)
  const [filters, setFilters] = useState<JournalFilters>({})
  const [treeOpen, setTreeOpen] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const [, startNav] = useTransition()
  const filtersKey = JSON.stringify(filters)

  const setUrl = useCallback(
    (id: string | null) => {
      // The author flyout lives over /journals/records — don't hijack the URL.
      if (author) return
      if (typeof window === 'undefined') return
      window.history.replaceState(null, '', id ? `/journals/${id}` : '/journals')
    },
    [author],
  )

  const reloadSidebar = useCallback(async () => {
    if (author) {
      const d = await fetchAuthorWorkspaceData({ author, groupBy, filters })
      if (d) setData(d)
      return
    }
    setData(await fetchWorkspace({ groupBy, filters }))
  }, [author, groupBy, filters])

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
      const tree = author
        ? await fetchAuthorTree({ author, groupBy: g, filters })
        : await fetchTree({ groupBy: g, filters })
      setData((d) => ({ ...d, tree }))
    } finally {
      setTreeLoading(false)
    }
  }

  const changeFilters = useCallback((partial: Partial<JournalFilters>) => {
    setFilters((f) => ({ ...f, ...partial }))
  }, [])

  function newEntry() {
    if (author) return // author flyout is review/edit only — no create-as-other
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
    if (author) return
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
      key={`${groupBy}:${data.tree[0]?.key ?? 'empty'}`}
      data={data}
      groupBy={groupBy}
      filters={filters}
      selectedId={entry?.id ?? null}
      loading={treeLoading}
      authorMode={!!author}
      onGroupByChange={changeGroupBy}
      onFiltersChange={changeFilters}
      onSelect={selectEntry}
      onNewEntry={newEntry}
      onPickDate={pickDate}
    />
  )

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-slate-50/40 dark:bg-slate-950">
      {/* Tree — desktop column */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 lg:block dark:border-slate-800">
        {sidebar}
      </aside>

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
              className="absolute top-0 right-0 h-full w-[88%] max-w-xs border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            >
              {sidebar}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {entry ? (
            <EditorPane
              key={entry.id}
              entry={entry}
              sites={data.sites}
              people={data.people}
              tagSuggestions={data.tagSuggestions}
              aiEnabled={data.aiEnabled}
              onMutated={onMutated}
              onDeleted={onDeleted}
              onLocalPatch={onLocalPatch}
              onBrowse={() => setTreeOpen(true)}
            />
          ) : (
            <EmptyEditor
              aiEnabled={data.aiEnabled}
              onNew={newEntry}
              onBrowse={() => setTreeOpen(true)}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function EmptyEditor({
  aiEnabled,
  onNew,
  onBrowse,
}: {
  aiEnabled: boolean
  onNew: () => void
  onBrowse: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
        <NotebookPen size={30} />
      </div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Start today’s journal
      </h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Capture what you worked on, hazards you spotted, and what got done. Add photos, dictate by
        voice{aiEnabled ? ', and let AI tidy it up, tag it, and flag safety concerns.' : '.'}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onNew}
          // Guided-tour anchor (lib/walkthroughs 'daily-journal').
          data-walkthrough="journals-new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
        >
          <Plus size={16} /> New entry
        </button>
        <button
          type="button"
          onClick={onBrowse}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <NotebookPen size={16} /> Browse
        </button>
      </div>
      {aiEnabled ? (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <Sparkles size={12} className="text-teal-500" /> AI assist is on
        </div>
      ) : null}
    </div>
  )
}
