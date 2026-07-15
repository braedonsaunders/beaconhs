'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

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
import { mergeTreePages } from './_tree-pages'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [data, setData] = useState(initialData)
  const [entry, setEntry] = useState(initialEntry)
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy)
  const [filters, setFilters] = useState<JournalFilters>({})
  const [treeOpen, setTreeOpen] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeLoadingMore, setTreeLoadingMore] = useState(false)
  const [, startNav] = useTransition()
  const filtersKey = JSON.stringify(filters)
  const treeRequestId = useRef(0)

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
    const requestId = ++treeRequestId.current
    if (author) {
      const d = await fetchAuthorWorkspaceData({ author, groupBy, filters })
      if (d && requestId === treeRequestId.current) setData(d)
      return
    }
    const next = await fetchWorkspace({ groupBy, filters })
    if (requestId === treeRequestId.current) setData(next)
  }, [author, groupBy, filters])

  // Refetch the tree/sidebar whenever filters change. The explicit key guard
  // avoids a duplicate fetch when groupBy changes the reload callback; that
  // path is fetched immediately by changeGroupBy below.
  const previousFiltersKey = useRef(filtersKey)
  useEffect(() => {
    if (previousFiltersKey.current === filtersKey) return
    previousFiltersKey.current = filtersKey
    void reloadSidebar()
  }, [filtersKey, reloadSidebar])

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
      toast.error(tGenerated('m_0065fba0031114'))
    }
  }

  async function changeGroupBy(g: GroupBy) {
    setGroupBy(g)
    setTreeLoading(true)
    const requestId = ++treeRequestId.current
    try {
      const page = author
        ? await fetchAuthorTree({ author, groupBy: g, filters })
        : await fetchTree({ groupBy: g, filters })
      if (requestId !== treeRequestId.current) return
      setData((d) => ({
        ...d,
        tree: page.nodes,
        treeHasMore: page.hasMore,
        treeNextCursor: page.nextCursor,
      }))
    } finally {
      if (requestId === treeRequestId.current) setTreeLoading(false)
    }
  }

  async function loadOlderEntries() {
    if (treeLoading || treeLoadingMore || !data.treeHasMore) return
    setTreeLoadingMore(true)
    const requestId = ++treeRequestId.current
    try {
      const page = author
        ? await fetchAuthorTree({
            author,
            groupBy,
            filters,
            cursor: data.treeNextCursor,
          })
        : await fetchTree({ groupBy, filters, cursor: data.treeNextCursor })
      if (requestId !== treeRequestId.current) return
      setData((current) => ({
        ...current,
        tree: mergeTreePages(current.tree, page.nodes, groupBy),
        treeHasMore: page.hasMore,
        treeNextCursor: page.nextCursor,
      }))
    } finally {
      setTreeLoadingMore(false)
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
        toast.error(tGeneratedValue(r.error))
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
        toast.error(tGeneratedValue(r.error))
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
      loadingMore={treeLoadingMore}
      authorMode={!!author}
      onGroupByChange={changeGroupBy}
      onFiltersChange={changeFilters}
      onSelect={selectEntry}
      onLoadMore={loadOlderEntries}
      onNewEntry={newEntry}
      onPickDate={pickDate}
    />
  )

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-slate-50/40 dark:bg-slate-950">
      {/* Tree — desktop column */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 lg:block dark:border-slate-800">
        <GeneratedValue value={sidebar} />
      </aside>

      {/* Tree — mobile Browse flyout: right-side, animated (matches app drawers) */}
      <AnimatePresence>
        <GeneratedValue
          value={
            treeOpen ? (
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
                  <GeneratedValue value={sidebar} />
                </motion.aside>
              </div>
            ) : null
          }
        />
      </AnimatePresence>

      {/* Editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <GeneratedValue
            value={
              entry ? (
                <EditorPane
                  key={entry.id}
                  entry={entry}
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
              )
            }
          />
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
        <GeneratedText id="m_12f6be73518266" />
      </h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_0ae4eeb19b1bad" />
        <GeneratedValue value={aiEnabled ? <GeneratedText id="m_1003c0990a5a33" /> : '.'} />
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onNew}
          // Guided-tour anchor (lib/walkthroughs 'daily-journal').
          data-walkthrough="journals-new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
        >
          <Plus size={16} /> <GeneratedText id="m_0036397741744c" />
        </button>
        <button
          type="button"
          onClick={onBrowse}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <NotebookPen size={16} /> <GeneratedText id="m_12c9bcb4cba5b7" />
        </button>
      </div>
      <GeneratedValue
        value={
          aiEnabled ? (
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <Sparkles size={12} className="text-teal-500" />{' '}
              <GeneratedText id="m_1cd0c39d0e9e4d" />
            </div>
          ) : null
        }
      />
    </div>
  )
}
