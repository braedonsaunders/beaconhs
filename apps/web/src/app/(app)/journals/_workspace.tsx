'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// The Journals workspace shell: a responsive 2-pane app (tree · editor). On
// desktop the tree sits beside the editor; on mobile the tree is a slide-over
// drawer and the editor is full-screen. Entries edit local-first (see
// ./_editor-pane.tsx); entries already opened in this session stay available
// to switch back to without signal. Opening another entry from the server or
// starting a new one needs signal.

import { useCallback, useEffect, useEffectEvent, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Drawer, Input, Skeleton } from '@beaconhs/ui'
import { useLocale, useTimeZone } from 'next-intl'
import { Plus } from 'lucide-react'
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
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import type { JournalFieldValues } from './_editor-pane'
import { formatLongDate } from './_format'
import { isJournalDate, journalDateChoices } from './_dates'
import type { AppLocale } from '@beaconhs/i18n'

/** An entry's field values (what the record saver owns). */
function fieldValues(entry: JournalEntryDetail): JournalFieldValues {
  return {
    bodyHtml: entry.bodyHtml,
    entryDate: entry.entryDate,
    definition: entry.definition,
    siteOrgUnitId: entry.siteOrgUnitId,
    supervisorPersonId: entry.supervisorPersonId,
    tags: entry.tags,
  }
}

/**
 * Merge a refetched entry (after a photo, submit, or unlock) into the one the
 * page holds. While the entry is still an editable draft, its field values
 * stay as they were: the fields own them (their edits may still be queued),
 * and a refetch that raced an edit must never overwrite it on screen.
 */
function mergeRefreshed(
  current: JournalEntryDetail,
  refreshed: JournalEntryDetail,
): JournalEntryDetail {
  const editable = refreshed.canEdit && !refreshed.locked && refreshed.status === 'draft'
  return editable ? { ...refreshed, ...fieldValues(current) } : refreshed
}

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
  const locale = useLocale() as AppLocale
  const timeZone = useTimeZone() ?? 'America/Toronto'
  const runOnline = useOnlineAction()
  const [data, setData] = useState(initialData)
  const [entry, setEntry] = useState(initialEntry)
  // Entries opened in this session, kept current with what the server has
  // acknowledged, so switching back to one works without signal.
  const openedRef = useRef<Map<string, JournalEntryDetail> | null>(null)
  function openedEntries(): Map<string, JournalEntryDetail> {
    openedRef.current ??= new Map(initialEntry ? [[initialEntry.id, initialEntry]] : [])
    return openedRef.current
  }
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy)
  const [filters, setFilters] = useState<JournalFilters>({})
  const [treeOpen, setTreeOpen] = useState(false)
  const [newEntryOpen, setNewEntryOpen] = useState(false)
  const [dateChoices, setDateChoices] = useState<{ today: string; tomorrow: string } | null>(null)
  const [chosenDate, setChosenDate] = useState('')
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

  const openInitialJournal = useEffectEvent(() => openDate())
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

  function show(detail: JournalEntryDetail) {
    openedEntries().set(detail.id, detail)
    setEntry(detail)
    setUrl(detail.id)
    setOpenError(null)
  }

  async function selectEntry(id: string) {
    setTreeOpen(false)
    const requestId = ++entryRequestId.current
    if (id === entry?.id) return
    // Without signal, an entry already opened here comes back from memory;
    // its unsynced edits are restored from this device.
    const known = openedEntries().get(id)
    if (known && !navigator.onLine) {
      show(known)
      return
    }
    // Online: push this entry's queued edits, then load the other one fresh.
    await runOnline('start', async () => {
      try {
        const detail = await fetchEntry(id)
        if (requestId !== entryRequestId.current) return
        if (!detail) throw new Error(tGenerated('m_0065fba0031114'))
        show(detail)
      } catch (error) {
        unstable_rethrow(error)
        if (requestId !== entryRequestId.current) return
        const message = error instanceof Error ? error.message : 'Could not open your journal.'
        setOpenError(message)
        toast.error(tGeneratedValue(message))
      }
    })
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
    if (authorEntryId || !data.canCreate || openingRequest.current) return
    const choices = journalDateChoices(new Date(), timeZone)
    setDateChoices(choices)
    setChosenDate(choices.tomorrow)
    setOpenError(null)
    setTreeOpen(false)
    setNewEntryOpen(true)
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
        // Creating (or resuming) a date's entry needs signal; this entry's
        // queued edits are pushed first.
        const ran = await runOnline('start', async () => {
          if (requestId !== entryRequestId.current) return
          try {
            const result = await createEntryForDate(dateISO)
            if (requestId !== entryRequestId.current) return
            if (!result.ok) throw new Error(result.error)
            show(result.entry)
            setTreeOpen(false)
            setNewEntryOpen(false)
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
          }
        })
        // Refused (no signal, or edits that could not be delivered — the
        // toast says which): leave a retry instead of an endless skeleton.
        if (!ran && requestId === entryRequestId.current) {
          setOpenError('Could not open your journal.')
        }
      } finally {
        openingRequest.current = false
      }
    })
  }

  async function onMutated() {
    if (entry) {
      const id = entry.id
      try {
        const refreshed = await fetchEntry(id)
        if (refreshed) {
          const known = openedEntries().get(id)
          openedEntries().set(id, known ? mergeRefreshed(known, refreshed) : refreshed)
          setEntry((current) =>
            current && current.id === id ? mergeRefreshed(current, refreshed) : current,
          )
        }
      } catch (error) {
        unstable_rethrow(error)
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : 'Could not open your journal.'),
        )
      }
    }
    await reloadSidebar()
  }

  function onDeleted() {
    ++entryRequestId.current
    if (entry) openedEntries().delete(entry.id)
    setEntry(null)
    setUrl(null)
    if (data.canCreate && !authorEntryId) openDate()
    else void reloadSidebar()
  }

  function onStatusChange(patch: Pick<JournalEntryDetail, 'status' | 'locked'>) {
    setEntry((e) => (e ? { ...e, ...patch } : e))
  }

  function onSynced(id: string, patch: Partial<JournalFieldValues>) {
    const known = openedEntries().get(id)
    if (known) openedEntries().set(id, { ...known, ...patch })
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
        {!authorEntryId && data.canCreate ? (
          <div className="flex shrink-0 justify-end border-b border-slate-200 bg-white px-3 py-1.5 lg:hidden dark:border-slate-800 dark:bg-slate-900">
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              variant="outline"
              onClick={newEntry}
              disabled={opening}
              data-walkthrough="journals-new-mobile"
            >
              <Plus size={15} /> <GeneratedText id="m_0036397741744c" />
            </Button>
          </div>
        ) : null}
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
                  onStatusChange={onStatusChange}
                  onSynced={(patch) => onSynced(entry.id, patch)}
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

      <Drawer
        open={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
        title={<GeneratedValue value="New journal entry" />}
        description={
          <GeneratedValue value="An existing journal for this date opens instead of creating another entry." />
        }
        size="sm"
      >
        {dateChoices ? (
          <div className="space-y-6" aria-busy={opening}>
            <div className="grid grid-cols-2 gap-3">
              {(['today', 'tomorrow'] as const).map((choice, index) => (
                <Button
                  key={choice}
                  type="button"
                  variant={choice === 'tomorrow' ? 'default' : 'outline'}
                  className="h-auto min-h-16 flex-col gap-1 px-2 py-3 whitespace-normal"
                  disabled={opening}
                  onClick={() => openDate(dateChoices[choice])}
                >
                  <span className="block first-letter:uppercase">
                    {new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(index, 'day')}
                  </span>
                  <span className="text-xs font-normal">
                    {formatLongDate(dateChoices[choice], locale)}
                  </span>
                </Button>
              ))}
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (isJournalDate(chosenDate)) openDate(chosenDate)
              }}
            >
              <label className="block space-y-2 text-sm font-medium">
                <span>
                  <GeneratedValue value="Choose date" />
                </span>
                <Input
                  type="date"
                  aria-label={tGeneratedValue('Journal date')}
                  value={chosenDate}
                  onChange={(event) => setChosenDate(event.target.value)}
                  required
                  disabled={opening}
                />
              </label>
              <Button
                type="submit"
                className="w-full"
                disabled={opening || !isJournalDate(chosenDate)}
              >
                <GeneratedValue value="Open journal" />
              </Button>
            </form>
            {openError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                <GeneratedValue value={openError} />
              </p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
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
