'use client'

// The admin/safety "browse all journals" surface. A sticky filter toolbar over a
// results region that switches between three views — Split (list + live reader),
// Table (dense rows), and Cards — with infinite scroll and a read-only reader.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Columns2,
  Download,
  LayoutGrid,
  Loader2,
  MapPin,
  Image as ImageIcon,
  Rows3,
  Search,
  X,
} from 'lucide-react'
import { cn, SearchSelect, Select } from '@beaconhs/ui'
import { tagSwatch } from '../_tag-colors'
import { formatLongDate, statusMeta } from '../_format'
import { fetchEntry } from '../_actions'
import { fetchRecords } from './_actions'
import { Avatar, RecordReader } from './_reader'
import type {
  JournalEntryDetail,
  JournalFilters,
  JournalListItem,
  JournalOption,
  TagSuggestion,
} from '../_types'

type View = 'split' | 'table' | 'cards'

export function RecordsBrowser({
  initialItems,
  initialTotal,
  pageSize,
  sites,
  people,
  tags,
}: {
  initialItems: JournalListItem[]
  initialTotal: number | null
  pageSize: number
  sites: JournalOption[]
  people: JournalOption[]
  tags: TagSuggestion[]
}) {
  const [view, setView] = useState<View>('split')
  const [filters, setFilters] = useState<JournalFilters>({})
  const [q, setQ] = useState('')
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState<number | null>(initialTotal)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reader, setReader] = useState<JournalEntryDetail | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [slideOpen, setSlideOpen] = useState(false)

  const tagColors = useMemo(() => new Map(tags.map((t) => [t.name, t.color])), [tags])
  const hasMore = total === null ? items.length >= pageSize : items.length < total
  const filterKey = JSON.stringify(filters)
  const seq = useRef(0)
  const loadingMore = useRef(false)

  // Debounce search → filters.q
  useEffect(() => {
    const t = setTimeout(
      () =>
        setFilters((f) =>
          f.q === (q.trim() || undefined) ? f : { ...f, q: q.trim() || undefined },
        ),
      300,
    )
    return () => clearTimeout(t)
  }, [q])

  // Refetch page 1 whenever filters change (skip first render — server seeded it).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const mine = ++seq.current
    setBusy(true)
    fetchRecords({ filters, offset: 0, withTotal: true }).then((res) => {
      if (mine !== seq.current) return
      setItems(res.items)
      setTotal(res.total ?? 0)
      setBusy(false)
      setSelectedId(null)
      setReader(null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  const loadMore = useCallback(() => {
    if (loadingMore.current || busy || !hasMore) return
    loadingMore.current = true
    setMore(true)
    const mine = seq.current
    fetchRecords({ filters, offset: items.length }).then((res) => {
      if (mine === seq.current) {
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...res.items.filter((r) => !seen.has(r.id))]
        })
      }
      loadingMore.current = false
      setMore(false)
    })
  }, [filters, items.length, busy, hasMore])

  function openReader(id: string) {
    setSelectedId(id)
    if (view !== 'split') setSlideOpen(true)
    setReaderLoading(true)
    fetchEntry(id).then((e) => {
      setReader(e)
      setReaderLoading(false)
    })
  }

  // Split view: auto-open the first entry for an immediate reading surface.
  useEffect(() => {
    if (view === 'split' && !selectedId && items.length > 0) openReader(items[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, items, selectedId])

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore()
  }

  const activeCount = Object.values(filters).filter((v) => v !== undefined && v !== '').length
  const exportHref =
    '/journals/export.csv?' +
    new URLSearchParams(
      Object.entries(filters).flatMap(([k, v]) => (v ? [[k, String(v)]] : [])) as [
        string,
        string,
      ][],
    ).toString()

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/40 dark:bg-slate-900/40">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search journals…"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm transition outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="w-44">
            <SearchSelect
              value={filters.person ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, person: v || undefined }))}
              clearable
              emptyLabel="All people"
              placeholder="All people"
              searchPlaceholder="Search people…"
              sheetTitle="Person"
              ariaLabel="Filter by person"
              options={people.map((p) => ({ value: p.id, label: p.name, hint: p.hint }))}
            />
          </div>
          <div className="w-40">
            <SearchSelect
              value={filters.site ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, site: v || undefined }))}
              clearable
              emptyLabel="All sites"
              placeholder="All sites"
              searchPlaceholder="Search sites…"
              sheetTitle="Site"
              ariaLabel="Filter by site"
              options={sites.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>

          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
            aria-label="From date"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
            aria-label="To date"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          />

          <Select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                status: (e.target.value || undefined) as JournalFilters['status'],
              }))
            }
            aria-label="Status"
            className="h-9 text-sm"
          >
            <option value="">Any status</option>
            <option value="submitted">Submitted</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </Select>
          <Select
            value={filters.definition ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                definition: (e.target.value || undefined) as JournalFilters['definition'],
              }))
            }
            aria-label="Type"
            className="h-9 text-sm"
          >
            <option value="">Any type</option>
            <option value="worker">Worker</option>
            <option value="supervisor">Supervisor</option>
          </Select>
          <div className="w-40">
            <SearchSelect
              value={filters.tag ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, tag: v || undefined }))}
              clearable
              emptyLabel="Any tag"
              placeholder="Any tag"
              searchPlaceholder="Search tags…"
              sheetTitle="Tag"
              ariaLabel="Filter by tag"
              options={tags.map((t) => ({ value: t.name, label: t.name }))}
            />
          </div>

          {activeCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setFilters({})
                setQ('')
              }}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X size={13} /> Clear
            </button>
          ) : null}
        </div>

        {/* Count + export + view toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {busy ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </span>
            ) : (
              <>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {(total ?? items.length).toLocaleString()}
                </span>{' '}
                {total === 1 ? 'journal' : 'journals'}
              </>
            )}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <a
              href={exportHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60"
              title="Export filtered results to CSV"
            >
              <Download size={13} /> Export
            </a>
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              <ViewBtn
                active={view === 'split'}
                onClick={() => setView('split')}
                label="Split view"
              >
                <Columns2 size={15} />
              </ViewBtn>
              <ViewBtn
                active={view === 'table'}
                onClick={() => setView('table')}
                label="Table view"
              >
                <Rows3 size={15} />
              </ViewBtn>
              <ViewBtn active={view === 'cards'} onClick={() => setView('cards')} label="Card view">
                <LayoutGrid size={15} />
              </ViewBtn>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1">
        {items.length === 0 && !busy ? (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-400">
            No journals match these filters.
          </div>
        ) : view === 'split' ? (
          <div className="flex h-full min-h-0">
            <div
              onScroll={onScroll}
              className="app-scroll w-[360px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              {items.map((it) => (
                <SplitRow
                  key={it.id}
                  item={it}
                  active={it.id === selectedId}
                  onClick={() => openReader(it.id)}
                />
              ))}
              <MoreFooter more={more} hasMore={hasMore} />
            </div>
            <div className="min-h-0 flex-1">
              <RecordReader entry={reader} loading={readerLoading} tagColors={tagColors} />
            </div>
          </div>
        ) : view === 'table' ? (
          <div onScroll={onScroll} className="app-scroll h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 text-left text-[11px] tracking-wide text-slate-400 uppercase backdrop-blur dark:bg-slate-900/80">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-2 font-medium">Author</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 text-center font-medium">
                    <ImageIcon size={13} className="inline" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <TableRow
                    key={it.id}
                    item={it}
                    active={it.id === selectedId}
                    tagColors={tagColors}
                    onClick={() => openReader(it.id)}
                  />
                ))}
              </tbody>
            </table>
            <MoreFooter more={more} hasMore={hasMore} />
          </div>
        ) : (
          <div onScroll={onScroll} className="app-scroll h-full overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((it) => (
                <CardItem
                  key={it.id}
                  item={it}
                  tagColors={tagColors}
                  onClick={() => openReader(it.id)}
                />
              ))}
            </div>
            <MoreFooter more={more} hasMore={hasMore} />
          </div>
        )}
      </div>

      {/* Slide-over reader for table / card views */}
      <AnimatePresence>
        {slideOpen && view !== 'split' ? (
          <div className="fixed inset-0 z-50">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              onClick={() => setSlideOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.8 }}
              className="absolute top-0 right-0 h-full w-[92%] max-w-xl border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            >
              <RecordReader
                entry={reader}
                loading={readerLoading}
                tagColors={tagColors}
                onClose={() => setSlideOpen(false)}
              />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// --- rows / cards ----------------------------------------------------------

function SplitRow({
  item,
  active,
  onClick,
}: {
  item: JournalListItem
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left transition-colors dark:border-slate-800',
        active ? 'bg-teal-50 dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
      )}
    >
      <Avatar name={item.authorName} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {item.authorName ?? 'Unassigned'}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {formatLongDate(item.entryDate)}
          </span>
        </div>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.snippet || '—'}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          {item.siteName ? <span className="truncate">{item.siteName}</span> : null}
          {item.photoCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <ImageIcon size={10} /> {item.photoCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function TableRow({
  item,
  active,
  tagColors,
  onClick,
}: {
  item: JournalListItem
  active: boolean
  tagColors: Map<string, string | null>
  onClick: () => void
}) {
  const status = statusMeta(item.status)
  return (
    <tr
      onClick={onClick}
      className={cn(
        'cursor-pointer border-b border-slate-100 transition-colors dark:border-slate-800',
        active ? 'bg-teal-50 dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
      )}
    >
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Avatar name={item.authorName} size={26} />
          <span className="truncate font-medium text-slate-800 dark:text-slate-200">
            {item.authorName ?? 'Unassigned'}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">
        {formatLongDate(item.entryDate)}
      </td>
      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{item.siteName ?? '—'}</td>
      <td className="max-w-[24rem] px-3 py-2 text-slate-500 dark:text-slate-400">
        <span className="line-clamp-1">{item.snippet || '—'}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex max-w-[14rem] flex-wrap gap-1">
          {item.tags.slice(0, 3).map((t) => {
            const sw = tagSwatch(tagColors.get(t) ?? null)
            return (
              <span
                key={t}
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                  sw.chip,
                )}
              >
                {t}
              </span>
            )
          })}
          {item.tags.length > 3 ? (
            <span className="text-[10px] text-slate-400">+{item.tags.length - 3}</span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={cn(
            'rounded-full px-2 py-px text-[10px] font-medium ring-1 ring-inset',
            status.className,
          )}
        >
          {status.label}
        </span>
      </td>
      <td className="px-3 py-2 text-center text-xs text-slate-400">{item.photoCount || ''}</td>
    </tr>
  )
}

function CardItem({
  item,
  tagColors,
  onClick,
}: {
  item: JournalListItem
  tagColors: Map<string, string | null>
  onClick: () => void
}) {
  const status = statusMeta(item.status)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={item.authorName} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {item.authorName ?? 'Unassigned'}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {formatLongDate(item.entryDate)}
            {item.siteName ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5 truncate">
                  <MapPin size={10} /> {item.siteName}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-px text-[10px] font-medium ring-1 ring-inset',
            status.className,
          )}
        >
          {status.label}
        </span>
      </div>
      <p className="line-clamp-3 text-sm text-slate-600 dark:text-slate-400">
        {item.snippet || 'No content.'}
      </p>
      {item.tags.length > 0 || item.photoCount > 0 ? (
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {item.tags.slice(0, 4).map((t) => {
            const sw = tagSwatch(tagColors.get(t) ?? null)
            return (
              <span
                key={t}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                  sw.chip,
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', sw.dot)} />
                {t}
              </span>
            )
          })}
          {item.photoCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
              <ImageIcon size={11} /> {item.photoCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  )
}

function MoreFooter({ more, hasMore }: { more: boolean; hasMore: boolean }) {
  if (more)
    return (
      <div className="flex items-center justify-center gap-2 py-5 text-xs text-slate-400">
        <Loader2 size={14} className="animate-spin" /> Loading more…
      </div>
    )
  if (!hasMore)
    return <div className="py-5 text-center text-[11px] text-slate-300">End of results</div>
  return <div className="h-6" />
}

function ViewBtn({
  children,
  active,
  onClick,
  label,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-7 w-8 place-items-center rounded-md transition-colors',
        active
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
      )}
    >
      {children}
    </button>
  )
}
