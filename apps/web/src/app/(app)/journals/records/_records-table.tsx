'use client'

// Client table + flyouts for the journal records list. Rows and flyouts are
// CLIENT-state driven (not URL params), so opening/closing a flyout never
// re-runs the page's server component — the list no longer refetches or
// re-staggers on every open/close. Sorting still navigates (SortTh links), which
// is the only time a re-query is wanted.
//
// Row click → read-only flyout (JournalView). "Open full entry" → a larger
// flyout embedding the full editable workspace scoped to that author's journals.

import { useMemo, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { FileDown, Image as ImageIcon, Loader2, PenLine } from 'lucide-react'
import { Badge, Button, Drawer, cn } from '@beaconhs/ui'
import type { AppLocale } from '@beaconhs/i18n'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { tagSwatch } from '../_tag-colors'
import { formatLongDate, statusMeta } from '../_format'
import { fetchAuthorWorkspace, fetchEntry } from '../_actions'
import { JournalWorkspace } from '../_workspace'
import { JournalView } from './_journal-view'
import type {
  AuthorRef,
  JournalEntryDetail,
  JournalListItem,
  JournalStatus,
  WorkspaceData,
} from '../_types'

type SortProps = {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
}

export function JournalRecordsTable({
  items,
  tagColors,
  sortProps,
}: {
  items: JournalListItem[]
  /** name → governed colour (plain object so it crosses the RSC boundary). */
  tagColors: Record<string, string | null>
  sortProps: SortProps
}) {
  const locale = useLocale() as AppLocale
  const colorMap = useMemo(() => new Map(Object.entries(tagColors)), [tagColors])

  // Read-only flyout state.
  const [readId, setReadId] = useState<string | null>(null)
  const [readEntry, setReadEntry] = useState<JournalEntryDetail | null>(null)
  const [readLoading, setReadLoading] = useState(false)
  const idRef = useRef<string | null>(null)

  // Editable author-workspace flyout state.
  const [wsOpen, setWsOpen] = useState(false)
  const [wsLoading, setWsLoading] = useState(false)
  const [ws, setWs] = useState<{
    data: WorkspaceData
    entry: JournalEntryDetail
    author: AuthorRef
  } | null>(null)

  function openRead(id: string) {
    idRef.current = id
    setReadId(id)
    setReadEntry(null)
    setReadLoading(true)
    fetchEntry(id).then((e) => {
      // Ignore a stale resolve if the user already opened another row.
      if (idRef.current !== id) return
      setReadEntry(e)
      setReadLoading(false)
    })
  }

  function closeRead() {
    setReadId(null)
    setReadEntry(null)
  }

  function openWorkspace(id: string) {
    setReadId(null) // hand off from the read flyout
    setWsOpen(true)
    setWs(null)
    setWsLoading(true)
    fetchAuthorWorkspace(id).then((r) => {
      setWs(r)
      setWsLoading(false)
    })
  }

  function closeWorkspace() {
    setWsOpen(false)
    setWs(null)
  }

  return (
    <>
      {/* Phones: tappable cards. */}
      <MobileCardList>
        {items.map((it) => (
          <ListCard
            key={it.id}
            onClick={() => openRead(it.id)}
            person={it.authorName}
            reference={it.reference}
            status={<StatusBadge status={it.status} />}
            title={it.snippet || it.title || 'Journal entry'}
            meta={`${formatLongDate(it.entryDate, locale)}${it.siteName ? ` · ${it.siteName}` : ''}`}
            footer={
              <>
                {it.tags.slice(0, 3).map((t) => (
                  <TagChip key={t} tag={t} color={colorMap.get(t) ?? null} />
                ))}
                {it.photoCount > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                    <ImageIcon size={11} /> {it.photoCount}
                  </span>
                ) : null}
              </>
            }
          />
        ))}
      </MobileCardList>

      {/* Tablet/desktop: sortable table, whole row opens the flyout. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              <SortTh column="reference" {...sortProps}>
                Reference
              </SortTh>
              <SortTh column="author" {...sortProps}>
                Author
              </SortTh>
              <SortTh column="date" {...sortProps}>
                Date
              </SortTh>
              <SortTh column="site" {...sortProps}>
                Site
              </SortTh>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">Tags</th>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <th className="w-10 px-3 py-2 text-center">
                <ImageIcon size={13} className="inline" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((it) => (
              <tr
                key={it.id}
                onClick={() => openRead(it.id)}
                className={cn(
                  'cursor-pointer transition-colors',
                  it.id === readId
                    ? 'bg-teal-50/60 dark:bg-teal-500/10'
                    : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/60',
                )}
              >
                <td className="px-3 py-2 font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                  {it.reference}
                </td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                  {it.authorName ?? 'Unassigned'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular-nums dark:text-slate-400">
                  {formatLongDate(it.entryDate, locale)}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {it.siteName ?? '—'}
                </td>
                <td className="max-w-[22rem] px-3 py-2 text-slate-600 dark:text-slate-400">
                  <span className="line-clamp-1">{it.snippet || '—'}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex max-w-[14rem] flex-wrap gap-1">
                    {it.tags.slice(0, 3).map((t) => (
                      <TagChip key={t} tag={t} color={colorMap.get(t) ?? null} />
                    ))}
                    {it.tags.length > 3 ? (
                      <span className="text-[10px] text-slate-400">+{it.tags.length - 3}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={it.status} />
                </td>
                <td className="px-3 py-2 text-center text-xs text-slate-400">
                  {it.photoCount || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Read-only flyout */}
      <Drawer
        open={!!readId}
        onClose={closeRead}
        size="lg"
        title={readEntry ? (readEntry.authorName ?? 'Journal entry') : 'Journal entry'}
        description={
          readEntry
            ? `${formatLongDate(readEntry.entryDate, locale)} · ${readEntry.reference}`
            : undefined
        }
        footer={
          readEntry ? (
            <div className="flex w-full items-center justify-end gap-2">
              <a href={`/journals/${readEntry.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline">
                  <FileDown size={14} /> PDF
                </Button>
              </a>
              <Button onClick={() => openWorkspace(readEntry.id)}>
                <PenLine size={14} /> Open full entry
              </Button>
            </div>
          ) : undefined
        }
      >
        {readLoading ? (
          <LoadingPane />
        ) : readEntry ? (
          <JournalView entry={readEntry} tagColors={colorMap} />
        ) : (
          <Unavailable />
        )}
      </Drawer>

      {/* Editable author-workspace flyout */}
      <Drawer
        open={wsOpen}
        onClose={closeWorkspace}
        size="2xl"
        bodyClassName="overflow-hidden"
        title={ws ? `${ws.author.name ?? 'Journal'} — full entry` : 'Journal'}
        description={ws ? 'Browse and edit this author’s journals.' : undefined}
      >
        {wsLoading ? (
          <LoadingPane />
        ) : ws ? (
          <JournalWorkspace
            initialData={ws.data}
            initialEntry={ws.entry}
            initialGroupBy="date"
            author={ws.author}
          />
        ) : (
          <Unavailable />
        )}
      </Drawer>
    </>
  )
}

function LoadingPane() {
  return (
    <div className="grid h-full min-h-[40vh] place-items-center text-slate-400">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
}

function Unavailable() {
  return (
    <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
      This journal is unavailable or you don’t have access to it.
    </p>
  )
}

function StatusBadge({ status }: { status: JournalStatus }) {
  const locale = useLocale() as AppLocale
  const label = statusMeta(status, locale).label
  const variant =
    status === 'submitted' ? 'success' : status === 'archived' ? 'secondary' : 'warning'
  return <Badge variant={variant}>{label}</Badge>
}

function TagChip({ tag, color }: { tag: string; color: string | null }) {
  const sw = tagSwatch(color)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        sw.chip,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', sw.dot)} />
      {tag}
    </span>
  )
}
