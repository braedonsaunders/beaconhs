'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// The Journals workspace shell: a responsive 2-pane app (tree · editor). On
// desktop the tree sits beside the editor; on mobile the tree is a slide-over
// drawer and the editor is full-screen.

import { useCallback, useEffect, useEffectEvent, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Skeleton } from '@beaconhs/ui'
import { unstable_rethrow } from 'next/navigation'
import { toast } from 'sonner'
import { SidebarTree } from './_sidebar-tree'
import { EditorPane } from './_editor-pane'
import {
  createEntryForDate,
  fetchAuthorTree,
  fetchAuthorWorkspaceData,
  fetchEntry,
  fetchTree,
  fetchWorkspace,
} from './_actions'
import type { GroupBy, JournalEntryDetail, JournalFilters, WorkspaceData } from './_types'
import { mergeTreePages } from './_tree-pages'
import { flushRecordSaves } from '@/lib/pending-record-saves'

export function JournalWorkspace({
  initialData,
  initialEntry,
  initialGroupBy,
  authorEntryId = null,
}: {
  initialData: WorkspaceData
  initialEntry: JournalEntryDetail | null
  initialGroupBy: GroupBy
  /** When set, this is the records "Open full entry" flyout: the tree is scoped
   *  to this author's journals, the address bar is left alone, and create
   *  affordances are hidden. Omitted for the personal /journals workspace. */
  authorEntryId?: string | null
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
  const [opening, startNav] = useTransition()
  const [openError, setOpenError] = useState<string | null>(null)
  const openingRequest = useRef(false)
  const entryRequestId = useRef(0)
  const lastDate = useRef<string | undefined>(undefined)
  const autoOpened = useRef(false)
  const filtersKey = JSON.stringify(filters)
  const treeRequestId = useRef(0)

  const openInitialJournal = useEffectEvent(() => newEntry())
  useEffect(() => {
    if (autoOpened.current) return
    autoOpened.current = true
    if (!initialEntry && !authorEntryId && data.canCreate) openInitialJournal()
  }, [initialEntry, authorEntryId, data.canCreate])

  const setUrl = useCallback(
    (id: string | null) => {
      // The author flyout lives over /journals/records — don't hijack the URL.
      if (authorEntryId) return
      if (typeof window === 'undefined') return
      window.history.replaceState(null, '', id ? `/journals/${id}` : '/journals')
    },
    [authorEntryId],
  )

  const reloadSidebar = useCallback(async () => {
    const requestId = ++treeRequestId.current
    if (authorEntryId) {
      const d = await fetchAuthorWorkspaceData({ entryId: authorEntryId, groupBy, filters })
      if (d && requestId === treeRequestId.current) setData(d)
      return
    }
    const next = await fetchWorkspace({ groupBy, filters })
    if (requestId === treeRequestId.current) setData(next)
  }, [authorEntryId, groupBy, filters])

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

  async function saveBeforeLeaving(): Promise<boolean> {
    try {
      await flushRecordSaves()
      return true
    } catch (error) {
      toast.error(
        tGeneratedValue(error instanceof Error ? error.message : 'Could not save your journal.'),
      )
      return false
    }
  }

  async function selectEntry(id: string) {
    setTreeOpen(false)
    const requestId = ++entryRequestId.current
    if (id === entry?.id) return
    if (!(await saveBeforeLeaving())) return
    try {
      const detail = await fetchEntry(id)
      if (requestId !== entryRequestId.current) return
      if (!detail) throw new Error(tGenerated('m_0065fba0031114'))
      setEntry(detail)
      setUrl(id)
      setOpenError(null)
    } catch (error) {
      unstable_rethrow(error)
      if (requestId !== entryRequestId.current) return
      const message = error instanceof Error ? error.message : 'Could not open your journal.'
      setOpenError(message)
      toast.error(tGeneratedValue(message))
    }
  }

  async function changeGroupBy(g: GroupBy) {
    setGroupBy(g)
    setTreeLoading(true)
    const requestId = ++treeRequestId.current
    try {
      const page = authorEntryId
        ? await fetchAuthorTree({ entryId: authorEntryId, groupBy: g, filters })
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
      const page = authorEntryId
        ? await fetchAuthorTree({
            entryId: authorEntryId,
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
    openDate()
  }

  function pickDate(dateISO: string) {
    openDate(dateISO)
  }

  function openDate(dateISO?: string) {
    if (authorEntryId || !data.canCreate || openingRequest.current) return
    openingRequest.current = true
    lastDate.current = dateISO
    const requestId = ++entryRequestId.current
    setOpenError(null)
    startNav(async () => {
      try {
        if (!(await saveBeforeLeaving())) {
          if (requestId === entryRequestId.current) setOpenError('Could not save your journal.')
          return
        }
        if (requestId !== entryRequestId.current) return
        const result = await createEntryForDate(dateISO)
        if (requestId !== entryRequestId.current) return
        if (!result.ok) throw new Error(result.error)
        setEntry(result.entry)
        setUrl(result.entry.id)
        setTreeOpen(false)
        void reloadSidebar().catch((error: unknown) => {
          toast.error(
            tGeneratedValue(
              error instanceof Error ? error.message : 'Could not open your journal.',
            ),
          )
        })
      } catch (error) {
        unstable_rethrow(error)
        if (requestId !== entryRequestId.current) return
        const message = error instanceof Error ? error.message : 'Could not open your journal.'
        setOpenError(message)
        if (entry) toast.error(tGeneratedValue(message))
      } finally {
        openingRequest.current = false
      }
    })
  }

  async function onMutated() {
    if (entry) {
      if (!(await saveBeforeLeaving())) return
      const refreshed = await fetchEntry(entry.id)
      if (refreshed) {
        setEntry((current) => {
          if (!current || current.id !== entry.id) return current
          // Edits made during the refresh remain authoritative. The editor
          // itself stays mounted and never rehydrates from this response.
          return current === entry
            ? refreshed
            : {
                ...refreshed,
                bodyHtml: current.bodyHtml,
                tags: current.tags,
                definition: current.definition,
                siteOrgUnitId: current.siteOrgUnitId,
                supervisorPersonId: current.supervisorPersonId,
                entryDate: current.entryDate,
              }
        })
      }
    }
    await reloadSidebar()
  }

  function onDeleted() {
    ++entryRequestId.current
    setEntry(null)
    setUrl(null)
    if (data.canCreate && !authorEntryId) newEntry()
    else void reloadSidebar()
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
      authorMode={!!authorEntryId}
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
      <GeneratedValue
        value={
          // The open/closed conditional must be AnimatePresence's DIRECT child
          // (no GeneratedValue wrapper) or presence tracking breaks: the flyout
          // would unmount instantly with no exit animation.
          <AnimatePresence>
            {treeOpen ? (
              <div key="journals-tree-flyout" className="fixed inset-0 z-50 lg:hidden">
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
            ) : null}
          </AnimatePresence>
        }
      />

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
                <JournalPlaceholder
                  loading={!authorEntryId && data.canCreate && (opening || !openError)}
                  error={openError}
                  onRetry={() => openDate(lastDate.current)}
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

function JournalPlaceholder({
  loading,
  error,
  onRetry,
  onBrowse,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
  onBrowse: () => void
}) {
  if (loading) {
    return (
      <div aria-busy="true" className="h-full space-y-5 bg-white p-4 sm:p-6 dark:bg-slate-900">
        <Skeleton className="h-11 w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p
        role={error ? 'alert' : undefined}
        className="max-w-sm text-sm text-slate-500 dark:text-slate-400"
      >
        <GeneratedValue value={error ?? 'Choose a journal from Browse.'} />
      </p>
      <div className="mt-4 flex items-center gap-2">
        {error ? (
          <Button type="button" onClick={onRetry}>
            <GeneratedValue value="Retry opening journal" />
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onBrowse} className="lg:hidden">
          <GeneratedText id="m_12c9bcb4cba5b7" />
        </Button>
      </div>
    </div>
  )
}
