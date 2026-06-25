'use client'

// Outlook-style inbox. Three regions — a folder/tag rail, the message list, and
// a reading pane. On desktop all three sit side by side; on mobile the list is
// full-width and the rail + reading pane become slide-in flyouts. All mutations
// (read, unread, delete, mark-all) update optimistically; folder counts are kept
// in sync with exact local deltas so the rail never drifts.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  ChevronLeft,
  Flag,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Menu,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { Badge, Button, Drawer, cn } from '@beaconhs/ui'
import { categoryMeta } from './_categories'
import {
  deleteNotification,
  fetchInboxFolders,
  fetchInboxPage,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  type InboxFilter,
  type InboxFolders,
  type InboxItem,
} from './actions'

/* ------------------------------------------------------------------ helpers */

function useIsDesktop() {
  // Desktop-first so the SSR markup matches the most common case (no portal);
  // corrected on mount and on resize.
  const [isDesktop, setIsDesktop] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return isDesktop
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const filterKey = (f: InboxFilter) => (f.kind === 'category' ? `cat:${f.category}` : f.kind)

/** Exact local count deltas so the rail stays correct without a server round-trip. */
function applyDelta(
  folders: InboxFolders,
  item: InboxItem,
  action: 'read' | 'unread' | 'delete',
): InboxFolders {
  const wasUnread = !item.read
  const crit = item.isCritical
  let { total, unread, criticalTotal, criticalUnread } = folders
  let categories = folders.categories.map((c) => ({ ...c }))
  const ci = categories.findIndex((c) => c.category === item.category)

  const bumpUnread = (d: number) => {
    unread += d
    if (crit) criticalUnread += d
    if (ci >= 0) categories[ci]!.unread += d
  }

  if (action === 'read' && wasUnread) bumpUnread(-1)
  else if (action === 'unread' && !wasUnread) bumpUnread(1)
  else if (action === 'delete') {
    total -= 1
    if (crit) criticalTotal -= 1
    if (wasUnread) bumpUnread(-1)
    if (ci >= 0) {
      categories[ci]!.total -= 1
      if (categories[ci]!.total <= 0) categories = categories.filter((_, i) => i !== ci)
    }
  }
  return { total, unread, criticalTotal, criticalUnread, categories }
}

/* -------------------------------------------------------------- folder rail */

function CountPill({ value, active }: { value: number; active?: boolean }) {
  if (value <= 0) return null
  return (
    <span
      className={cn(
        'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
        active
          ? 'bg-teal-600 text-white dark:bg-teal-500'
          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

function FolderButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
        active
          ? 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950/40 dark:text-teal-100'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70',
      )}
    >
      <span
        className={cn('shrink-0', active ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400')}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <CountPill value={count} active={active} />
    </button>
  )
}

function FolderRail({
  folders,
  filter,
  onSelect,
  variant,
  className,
}: {
  folders: InboxFolders
  filter: InboxFilter
  onSelect: (f: InboxFilter) => void
  variant: 'rail' | 'flyout'
  className?: string
}) {
  const active = filterKey(filter)
  const categories = useMemo(
    () =>
      folders.categories
        .map((c) => ({ ...c, meta: categoryMeta(c.category) }))
        .sort((a, b) => a.meta.label.localeCompare(b.meta.label)),
    [folders.categories],
  )

  const nav = (
    <>
      <div className="space-y-0.5">
        <FolderButton
          icon={<Inbox size={16} />}
          label="All"
          count={folders.unread}
          active={active === 'all'}
          onClick={() => onSelect({ kind: 'all' })}
        />
        <FolderButton
          icon={<Mail size={16} />}
          label="Unread"
          count={folders.unread}
          active={active === 'unread'}
          onClick={() => onSelect({ kind: 'unread' })}
        />
        <FolderButton
          icon={<Flag size={16} />}
          label="Critical"
          count={folders.criticalUnread}
          active={active === 'critical'}
          onClick={() => onSelect({ kind: 'critical' })}
        />
      </div>

      {categories.length > 0 ? (
        <>
          <p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Categories
          </p>
          <div className="space-y-0.5">
            {categories.map((c) => {
              const Icon = c.meta.Icon
              return (
                <FolderButton
                  key={c.category}
                  icon={<Icon size={16} />}
                  label={c.meta.label}
                  count={c.unread}
                  active={active === `cat:${c.category}`}
                  onClick={() => onSelect({ kind: 'category', category: c.category })}
                />
              )
            })}
          </div>
        </>
      ) : null}
    </>
  )

  const preferences = (
    <Link
      href="/notifications/preferences"
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70"
    >
      <Settings size={16} className="shrink-0 text-slate-400" />
      Notification settings
    </Link>
  )

  if (variant === 'flyout') {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          {preferences}
        </div>
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Bell size={18} className="text-teal-600 dark:text-teal-400" />
        <span className="text-base font-semibold text-slate-900 dark:text-slate-100">Inbox</span>
      </div>
      <nav className="app-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">{nav}</nav>
      <div className="border-t border-slate-200 p-2 dark:border-slate-800">{preferences}</div>
    </aside>
  )
}

/* ------------------------------------------------------------- message list */

function MessageRow({
  item,
  selected,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  item: InboxItem
  selected: boolean
  onOpen: () => void
  onToggleRead: () => void
  onDelete: () => void
}) {
  const meta = categoryMeta(item.category)
  const Icon = meta.Icon
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex cursor-pointer gap-3 border-b border-slate-100 px-3 py-2.5 transition-colors sm:px-4 dark:border-slate-800/70',
        selected
          ? 'bg-teal-50/70 dark:bg-teal-950/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
      )}
    >
      {!item.read ? (
        <span className="absolute top-0 left-0 h-full w-[3px] bg-teal-500" aria-hidden />
      ) : null}

      <span
        className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          meta.bg,
        )}
      >
        <Icon size={16} className={meta.fg} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-xs',
              item.read
                ? 'text-slate-500 dark:text-slate-400'
                : 'font-semibold text-slate-700 dark:text-slate-200',
            )}
          >
            {meta.label}
          </span>
          <time
            suppressHydrationWarning
            className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-slate-400 group-hover:opacity-0 dark:text-slate-500"
          >
            {relativeTime(item.occurredAt)}
          </time>
        </div>
        <p
          className={cn(
            'truncate text-sm',
            item.read
              ? 'text-slate-600 dark:text-slate-300'
              : 'font-semibold text-slate-900 dark:text-slate-100',
          )}
        >
          {item.title}
        </p>
        {item.body ? (
          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{item.body}</p>
        ) : null}
        {item.isCritical ? (
          <Badge variant="destructive" className="mt-1 h-4 px-1.5 text-[10px]">
            Critical
          </Badge>
        ) : null}
      </div>

      {/* Hover actions (desktop) */}
      <div className="absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-md bg-white/95 p-0.5 shadow-sm group-hover:flex dark:bg-slate-800/95">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleRead()
          }}
          title={item.read ? 'Mark as unread' : 'Mark as read'}
          aria-label={item.read ? 'Mark as unread' : 'Mark as read'}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          {item.read ? <Mail size={14} /> : <MailOpen size={14} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="Delete"
          aria-label="Delete"
          className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- reading pane */

function ReadingPane({
  item,
  onToggleRead,
  onDelete,
  onClose,
}: {
  item: InboxItem | null
  onToggleRead: (item: InboxItem) => void
  onDelete: (item: InboxItem) => void
  onClose?: () => void // present only in the mobile flyout
}) {
  const router = useRouter()

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Mail size={28} className="text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Select an item to read
        </p>
        <p className="max-w-xs text-xs text-slate-400 dark:text-slate-500">
          Choose a notification from the list to see its full details here.
        </p>
      </div>
    )
  }

  const meta = categoryMeta(item.category)
  const Icon = meta.Icon

  const toolbar = (
    <div className="flex items-center gap-1.5">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="mr-1 -ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <ChevronLeft size={20} />
        </button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => onToggleRead(item)}>
        {item.read ? <Mail size={14} /> : <MailOpen size={14} />}
        {item.read ? 'Mark unread' : 'Mark read'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDelete(item)}
        className="text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
      >
        <Trash2 size={14} /> Delete
      </Button>
      {item.linkPath ? (
        <Button size="sm" className="ml-auto" onClick={() => router.push(item.linkPath as never)}>
          Open <ArrowUpRight size={14} />
        </Button>
      ) : null}
    </div>
  )

  const header = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            meta.bg,
          )}
        >
          <Icon size={18} className={meta.fg} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold text-slate-900 dark:text-slate-100">
            {item.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="secondary" className="font-normal">
              {meta.label}
            </Badge>
            {item.isCritical ? <Badge variant="destructive">Critical</Badge> : null}
            <span suppressHydrationWarning>{fullDate(item.occurredAt)}</span>
          </div>
        </div>
      </div>
    </>
  )

  const body = (
    <div className="space-y-5">
      {item.body ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">
          {item.body}
        </p>
      ) : (
        <p className="text-sm text-slate-400 dark:text-slate-500">No additional details.</p>
      )}
      {item.linkPath ? (
        <div>
          <Button onClick={() => router.push(item.linkPath as never)}>
            Open <ArrowUpRight size={16} />
          </Button>
        </div>
      ) : null}
    </div>
  )

  // Flyout (mobile): the Drawer owns scroll + outer padding, so flow normally.
  if (onClose) {
    return (
      <div className="space-y-4">
        {toolbar}
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">{header}</div>
        {body}
      </div>
    )
  }

  // Inline (desktop): fixed header, internally-scrolling body.
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        {toolbar}
        {header}
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">{body}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- shell */

export function OutlookInbox({
  initialItems,
  initialHasMore,
  initialFolders,
}: {
  initialItems: InboxItem[]
  initialHasMore: boolean
  initialFolders: InboxFolders
}) {
  const isDesktop = useIsDesktop()
  const [folders, setFolders] = useState(initialFolders)
  const [filter, setFilter] = useState<InboxFilter>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [items, setItems] = useState(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [, startTransition] = useTransition()

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  )

  // Reload page 1 whenever the filter changes (skip the initial render — the
  // server already provided that page).
  const reqRef = useRef(0)
  const firstRun = useRef(true)
  const load = useCallback(async (f: InboxFilter) => {
    const my = ++reqRef.current
    setLoading(true)
    try {
      const page = await fetchInboxPage({ filter: f })
      if (my !== reqRef.current) return
      setItems(page.items)
      setHasMore(page.hasMore)
    } finally {
      if (my === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    void load(filter)
  }, [filter, load])

  // Debounced search → folds into the active filter.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = search.trim() || undefined
      setFilter((f) => (f.q === q ? f : { ...f, q }))
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Infinite scroll within the current filter.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || loadingMoreRef.current) return
        loadingMoreRef.current = true
        try {
          const last = items[items.length - 1]
          if (!last) return
          const page = await fetchInboxPage({
            cursor: { occurredAt: last.occurredAt, id: last.id },
            filter,
          })
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.id))
            return [...prev, ...page.items.filter((i) => !seen.has(i.id))]
          })
          setHasMore(page.hasMore)
        } finally {
          loadingMoreRef.current = false
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items, hasMore, filter])

  /* mutations — optimistic items + exact folder deltas */

  const setRead = (item: InboxItem, read: boolean) => {
    if (item.read === read) return
    setFolders((f) => applyDelta(f, item, read ? 'read' : 'unread'))
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read } : i)))
    startTransition(() => {
      void (read ? markNotificationRead(item.id) : markNotificationUnread(item.id))
    })
  }

  const remove = (item: InboxItem) => {
    setSelectedId((sel) => (sel === item.id ? null : sel))
    setFolders((f) => applyDelta(f, item, 'delete'))
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    startTransition(() => {
      void deleteNotification(item.id)
    })
  }

  const open = (item: InboxItem) => {
    setSelectedId(item.id)
    if (!item.read) setRead(item, true)
  }

  const selectFolder = (f: InboxFilter) => {
    setFoldersOpen(false)
    setSelectedId(null)
    setSearch('')
    setFilter({ kind: f.kind, category: f.category })
  }

  const markAll = async () => {
    setItems((prev) => prev.map((i) => (i.read ? i : { ...i, read: true })))
    await markAllNotificationsRead(filter)
    setFolders(await fetchInboxFolders())
  }

  /* header labels + counts for the active folder */

  const active = useMemo(() => {
    if (filter.kind === 'category' && filter.category) {
      const c = folders.categories.find((x) => x.category === filter.category)
      const meta = categoryMeta(filter.category)
      return { label: meta.label, total: c?.total ?? 0, unread: c?.unread ?? 0 }
    }
    if (filter.kind === 'unread')
      return { label: 'Unread', total: folders.unread, unread: folders.unread }
    if (filter.kind === 'critical')
      return { label: 'Critical', total: folders.criticalTotal, unread: folders.criticalUnread }
    return { label: 'All', total: folders.total, unread: folders.unread }
  }, [filter, folders])

  const listBody =
    items.length === 0 ? (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Inbox size={26} className="text-slate-400" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          {search.trim() ? 'No matches' : 'Nothing here'}
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {search.trim() ? 'Try a different search term.' : "You're all caught up in this folder."}
        </p>
      </div>
    ) : (
      <>
        {items.map((n) => (
          <MessageRow
            key={n.id}
            item={n}
            selected={n.id === selectedId}
            onOpen={() => open(n)}
            onToggleRead={() => setRead(n, !n.read)}
            onDelete={() => remove(n)}
          />
        ))}
        {hasMore ? (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            You&rsquo;re all caught up.
          </p>
        )}
      </>
    )

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Folder rail — desktop */}
      <FolderRail
        variant="rail"
        folders={folders}
        filter={filter}
        onSelect={selectFolder}
        className="hidden w-64 shrink-0 lg:flex"
      />

      {/* Message list */}
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white lg:w-96 lg:flex-none xl:w-[28rem] dark:border-slate-800 dark:bg-slate-900">
        <header className="shrink-0 border-b border-slate-200 dark:border-slate-800">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            <button
              type="button"
              onClick={() => setFoldersOpen(true)}
              aria-label="Folders"
              className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {active.label}
              </h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {active.total} {active.total === 1 ? 'item' : 'items'}
                {active.unread > 0 ? ` · ${active.unread} unread` : ''}
              </p>
            </div>
            {active.unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                title="Mark all as read"
                aria-label="Mark all as read"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <CheckCheck size={18} />
              </button>
            ) : null}
            <Link
              href="/notifications/preferences"
              aria-label="Notification settings"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Settings size={18} />
            </Link>
          </div>
          <div className="px-3 pb-2.5 sm:px-4">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inbox"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-8 pl-8 text-sm text-slate-900 transition-colors outline-none placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="app-scroll relative min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="absolute inset-x-0 top-0 z-10 flex justify-center py-3">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </div>
          ) : null}
          {listBody}
        </div>
      </section>

      {/* Reading pane — desktop */}
      <section className="hidden min-w-0 flex-1 bg-white lg:flex dark:bg-slate-900">
        <div className="w-full">
          <ReadingPane
            item={selected}
            onToggleRead={(i) => setRead(i, !i.read)}
            onDelete={remove}
          />
        </div>
      </section>

      {/* Mobile flyouts (portal-based; mount only below lg) */}
      {!isDesktop ? (
        <>
          <Drawer
            open={foldersOpen}
            onClose={() => setFoldersOpen(false)}
            side="left"
            size="sm"
            title="Folders"
          >
            <FolderRail
              variant="flyout"
              folders={folders}
              filter={filter}
              onSelect={selectFolder}
            />
          </Drawer>

          <Drawer open={!!selectedId} onClose={() => setSelectedId(null)} size="lg">
            <ReadingPane
              item={selected}
              onToggleRead={(i) => setRead(i, !i.read)}
              onDelete={(i) => {
                remove(i)
                setSelectedId(null)
              }}
              onClose={() => setSelectedId(null)}
            />
          </Drawer>
        </>
      ) : null}
    </div>
  )
}
