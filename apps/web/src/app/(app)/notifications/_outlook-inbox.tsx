'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  Clock,
  Flag,
  Inbox,
  ListChecks,
  Loader2,
  Mail,
  MailOpen,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { Badge, Button, Drawer, cn } from '@beaconhs/ui'
import { categoryMeta } from './_categories'
import {
  deleteNotification,
  fetchInboxFolders,
  fetchInboxPage,
  fetchInboxTodos,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  snoozeNotification,
  type InboxFilter,
  type InboxFolders,
  type InboxItem,
  type TodoItem,
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
  return { total, unread, criticalTotal, criticalUnread, todos: folders.todos, categories }
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
      <GeneratedValue value={value > 99 ? '99+' : value} />
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
        <GeneratedValue value={icon} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">
        <GeneratedValue value={label} />
      </span>
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
          label={tGenerated('m_17201516610431')}
          count={folders.unread}
          active={active === 'all'}
          onClick={() => onSelect({ kind: 'all' })}
        />
        <FolderButton
          icon={<Mail size={16} />}
          label={tGenerated('m_1f52bb2f5303fe')}
          count={folders.unread}
          active={active === 'unread'}
          onClick={() => onSelect({ kind: 'unread' })}
        />
        <FolderButton
          icon={<Flag size={16} />}
          label={tGenerated('m_18d7cb789a27d6')}
          count={folders.criticalUnread}
          active={active === 'critical'}
          onClick={() => onSelect({ kind: 'critical' })}
        />
        <FolderButton
          icon={<ListChecks size={16} />}
          label={tGenerated('m_0a8edcde15b7f6')}
          count={folders.todos}
          active={active === 'todos'}
          onClick={() => onSelect({ kind: 'todos' })}
        />
      </div>

      <GeneratedValue
        value={
          categories.length > 0 ? (
            <>
              <p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                <GeneratedText id="m_079987edbcc20f" />
              </p>
              <div className="space-y-0.5">
                <GeneratedValue
                  value={categories.map((c) => {
                    const Icon = c.meta.Icon
                    return (
                      <FolderButton
                        key={c.category}
                        icon={<Icon size={16} />}
                        label={tGeneratedValue(c.meta.label)}
                        count={c.unread}
                        active={active === `cat:${c.category}`}
                        onClick={() => onSelect({ kind: 'category', category: c.category })}
                      />
                    )
                  })}
                />
              </div>
            </>
          ) : null
        }
      />
    </>
  )

  const preferences = (
    <Link
      href="/notifications/preferences"
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70"
    >
      <Settings size={16} className="shrink-0 text-slate-400" />
      <GeneratedText id="m_1aaac13822c572" />
    </Link>
  )

  if (variant === 'flyout') {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GeneratedValue value={nav} />
        </div>
        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          <GeneratedValue value={preferences} />
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
        <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_13b9d8a678398c" />
        </span>
      </div>
      <nav className="app-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <GeneratedValue value={nav} />
      </nav>
      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <GeneratedValue value={preferences} />
      </div>
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      <GeneratedValue
        value={
          !item.read ? (
            <span className="absolute top-0 left-0 h-full w-[3px] bg-teal-500" aria-hidden />
          ) : null
        }
      />

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
            <GeneratedValue value={meta.label} />
          </span>
          <time
            suppressHydrationWarning
            className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-slate-400 group-hover:opacity-0 dark:text-slate-500"
          >
            <GeneratedValue value={relativeTime(item.occurredAt)} />
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
          <GeneratedValue value={item.title} />
        </p>
        <GeneratedValue
          value={
            item.body ? (
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={item.body} />
              </p>
            ) : null
          }
        />
        <GeneratedValue
          value={
            item.isCritical ? (
              <Badge variant="destructive" className="mt-1 h-4 px-1.5 text-[10px]">
                <GeneratedText id="m_18d7cb789a27d6" />
              </Badge>
            ) : null
          }
        />
      </div>

      {/* Hover actions (desktop) */}
      <div className="absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-md bg-white/95 p-0.5 shadow-sm group-hover:flex dark:bg-slate-800/95">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleRead()
          }}
          title={tGeneratedValue(
            item.read ? tGenerated('m_1116fcfd202b02') : tGenerated('m_0d382ecc3e9f1b'),
          )}
          aria-label={tGeneratedValue(
            item.read ? tGenerated('m_1116fcfd202b02') : tGenerated('m_0d382ecc3e9f1b'),
          )}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <GeneratedValue value={item.read ? <Mail size={14} /> : <MailOpen size={14} />} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title={tGenerated('m_11773f3c3f7558')}
          aria-label={tGenerated('m_11773f3c3f7558')}
          className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- to-dos */

const TODO_META: Record<
  TodoItem['kind'],
  { label: string; Icon: typeof Inbox; bg: string; fg: string }
> = {
  compliance: {
    label: 'Compliance',
    Icon: ShieldCheck,
    bg: 'bg-teal-100 dark:bg-teal-950/40',
    fg: 'text-teal-600 dark:text-teal-300',
  },
  capa: {
    label: 'Corrective action',
    Icon: Wrench,
    bg: 'bg-amber-100 dark:bg-amber-950/40',
    fg: 'text-amber-600 dark:text-amber-300',
  },
}

function TodoRow({ todo, onOpen }: { todo: TodoItem; onOpen: () => void }) {
  const meta = TODO_META[todo.kind]
  const Icon = meta.Icon
  const overdue = todo.status === 'overdue'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 sm:px-4 dark:border-slate-800/70 dark:hover:bg-slate-800/40"
    >
      <span
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', meta.bg)}
      >
        <Icon size={16} className={meta.fg} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={meta.label} />
          </span>
          <GeneratedValue
            value={
              todo.dueOn ? (
                <span
                  className={cn(
                    'ml-auto shrink-0 text-[11px] whitespace-nowrap',
                    overdue ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-400',
                  )}
                >
                  <GeneratedText id="m_0fed2a204aff5a" /> <GeneratedValue value={todo.dueOn} />
                </span>
              ) : null
            }
          />
        </div>
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          <GeneratedValue value={todo.title} />
        </p>
        <GeneratedValue
          value={
            todo.subtitle ? (
              <p className="truncate text-xs text-slate-400 capitalize dark:text-slate-500">
                <GeneratedValue value={todo.subtitle} />
              </p>
            ) : null
          }
        />
      </div>
      <ArrowUpRight
        size={15}
        className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600"
      />
    </button>
  )
}

/* ------------------------------------------------------------- reading pane */

function ReadingPane({
  item,
  onToggleRead,
  onDelete,
  onSnooze,
  onClose,
}: {
  item: InboxItem | null
  onToggleRead: (item: InboxItem) => void
  onDelete: (item: InboxItem) => void
  onSnooze: (item: InboxItem) => void
  onClose?: () => void // present only in the mobile flyout
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Mail size={28} className="text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_12c5fc48d95616" />
        </p>
        <p className="max-w-xs text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_198ee41103e4a8" />
        </p>
      </div>
    )
  }

  const meta = categoryMeta(item.category)
  const Icon = meta.Icon

  const toolbar = (
    <div className="flex items-center gap-1.5">
      <GeneratedValue
        value={
          onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={tGenerated('m_1a7cefe5a9894e')}
              className="mr-1 -ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronLeft size={20} />
            </button>
          ) : null
        }
      />
      <Button variant="outline" size="sm" onClick={() => onToggleRead(item)}>
        <GeneratedValue value={item.read ? <Mail size={14} /> : <MailOpen size={14} />} />
        <GeneratedValue
          value={
            item.read ? (
              <GeneratedText id="m_106986e659fec9" />
            ) : (
              <GeneratedText id="m_1047814afe8a87" />
            )
          }
        />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onSnooze(item)}
        title={tGenerated('m_10f058b0058005')}
      >
        <Clock size={14} /> <GeneratedText id="m_0eb79fc842a7bf" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDelete(item)}
        className="text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
      >
        <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
      </Button>
      <GeneratedValue
        value={
          item.linkPath ? (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => router.push(item.linkPath as never)}
            >
              <GeneratedText id="m_107ab58c3c38bc" /> <ArrowUpRight size={14} />
            </Button>
          ) : null
        }
      />
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
            <GeneratedValue value={item.title} />
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="secondary" className="font-normal">
              <GeneratedValue value={meta.label} />
            </Badge>
            <GeneratedValue
              value={
                item.isCritical ? (
                  <Badge variant="destructive">
                    <GeneratedText id="m_18d7cb789a27d6" />
                  </Badge>
                ) : null
              }
            />
            <span suppressHydrationWarning>
              <GeneratedValue value={fullDate(item.occurredAt)} />
            </span>
          </div>
        </div>
      </div>
    </>
  )

  const body = (
    <div className="space-y-5">
      <GeneratedValue
        value={
          item.body ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">
              <GeneratedValue value={item.body} />
            </p>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_07ea5d88d36795" />
            </p>
          )
        }
      />
      <GeneratedValue
        value={
          item.linkPath ? (
            <div>
              <Button onClick={() => router.push(item.linkPath as never)}>
                <GeneratedText id="m_107ab58c3c38bc" /> <ArrowUpRight size={16} />
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  )

  // Flyout (mobile): the Drawer owns scroll + outer padding, so flow normally.
  if (onClose) {
    return (
      <div className="space-y-4">
        <GeneratedValue value={toolbar} />
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <GeneratedValue value={header} />
        </div>
        <GeneratedValue value={body} />
      </div>
    )
  }

  // Inline (desktop): fixed header, internally-scrolling body.
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <GeneratedValue value={toolbar} />
        <GeneratedValue value={header} />
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <GeneratedValue value={body} />
      </div>
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
  const tGenerated = useGeneratedTranslations()
  const isDesktop = useIsDesktop()
  const router = useRouter()
  const [folders, setFolders] = useState(initialFolders)
  const [filter, setFilter] = useState<InboxFilter>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [items, setItems] = useState(initialItems)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [, startTransition] = useTransition()

  const mode = filter.kind === 'todos' ? 'todos' : 'alerts'

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
      if (f.kind === 'todos') {
        const t = await fetchInboxTodos()
        if (my !== reqRef.current) return
        setTodos(t)
        setItems([])
        setHasMore(false)
      } else {
        const page = await fetchInboxPage({ filter: f })
        if (my !== reqRef.current) return
        setItems(page.items)
        setHasMore(page.hasMore)
      }
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

  const snooze = (item: InboxItem) => {
    // Snoozed alerts drop out of the inbox like a delete until they resurface.
    setSelectedId((sel) => (sel === item.id ? null : sel))
    setFolders((f) => applyDelta(f, item, 'delete'))
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    startTransition(() => {
      void snoozeNotification(item.id, 24)
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
    if (filter.kind === 'todos')
      return { label: 'To-dos', total: todos.length || folders.todos, unread: 0 }
    if (filter.kind === 'unread')
      return { label: 'Unread', total: folders.unread, unread: folders.unread }
    if (filter.kind === 'critical')
      return { label: 'Critical', total: folders.criticalTotal, unread: folders.criticalUnread }
    return { label: 'All', total: folders.total, unread: folders.unread }
  }, [filter, folders, todos])

  const todosBody =
    todos.length === 0 ? (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <ListChecks size={26} className="text-slate-400" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_1bea8555b065cf" />
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_1bc62895a924d6" />
        </p>
      </div>
    ) : (
      <>
        <GeneratedValue
          value={todos.map((t) => (
            <TodoRow key={t.id} todo={t} onOpen={() => router.push(t.linkPath as never)} />
          ))}
        />
      </>
    )

  const alertsBody =
    items.length === 0 ? (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Inbox size={26} className="text-slate-400" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <GeneratedValue
            value={
              search.trim() ? (
                <GeneratedText id="m_19a9b602cdcf05" />
              ) : (
                <GeneratedText id="m_1472b28843b169" />
              )
            }
          />
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          <GeneratedValue
            value={
              search.trim() ? (
                <GeneratedText id="m_0dcfd55260344b" />
              ) : (
                <GeneratedText id="m_0b1549498e610c" />
              )
            }
          />
        </p>
      </div>
    ) : (
      <>
        <GeneratedValue
          value={items.map((n) => (
            <MessageRow
              key={n.id}
              item={n}
              selected={n.id === selectedId}
              onOpen={() => open(n)}
              onToggleRead={() => setRead(n, !n.read)}
              onDelete={() => remove(n)}
            />
          ))}
        />
        <GeneratedValue
          value={
            hasMore ? (
              <div ref={sentinelRef} className="flex items-center justify-center py-6">
                <Loader2 size={18} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_00355779fd1925" />
              </p>
            )
          }
        />
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
              aria-label={tGenerated('m_1f749e388d1d74')}
              className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedValue value={active.label} />
              </h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                <GeneratedValue value={active.total} />{' '}
                <GeneratedValue
                  value={
                    active.total === 1 ? (
                      <GeneratedText id="m_089f2b1abdb347" />
                    ) : (
                      <GeneratedText id="m_1b8b2c7ab2238f" />
                    )
                  }
                />
                <GeneratedValue
                  value={
                    active.unread > 0 ? (
                      <GeneratedText id="m_19ee13d7ebc483" values={{ value0: active.unread }} />
                    ) : (
                      ''
                    )
                  }
                />
              </p>
            </div>
            <GeneratedValue
              value={
                active.unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAll()}
                    title={tGenerated('m_1b1b65b65130bf')}
                    aria-label={tGenerated('m_1b1b65b65130bf')}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    <CheckCheck size={18} />
                  </button>
                ) : null
              }
            />
            <Link
              href="/notifications/preferences"
              aria-label={tGenerated('m_1aaac13822c572')}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Settings size={18} />
            </Link>
          </div>
          <div className={cn('px-3 pb-2.5 sm:px-4', mode === 'todos' && 'hidden')}>
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tGenerated('m_1802352368be09')}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-8 pl-8 text-base text-slate-900 transition-colors outline-none placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-500/20 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
              />
              <GeneratedValue
                value={
                  search ? (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label={tGenerated('m_0465aaf099e62c')}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X size={14} />
                    </button>
                  ) : null
                }
              />
            </div>
          </div>
        </header>

        <div className="app-scroll relative min-h-0 flex-1 overflow-y-auto">
          <GeneratedValue
            value={
              loading ? (
                <div className="absolute inset-x-0 top-0 z-10 flex justify-center py-3">
                  <Loader2 size={16} className="animate-spin text-slate-400" />
                </div>
              ) : null
            }
          />
          <GeneratedValue value={mode === 'todos' ? todosBody : alertsBody} />
        </div>
      </section>

      {/* Reading pane — desktop */}
      <section className="hidden min-w-0 flex-1 bg-white lg:flex dark:bg-slate-900">
        <div className="w-full">
          <ReadingPane
            item={selected}
            onToggleRead={(i) => setRead(i, !i.read)}
            onDelete={remove}
            onSnooze={snooze}
          />
        </div>
      </section>

      {/* Mobile flyouts (portal-based; mount only below lg) */}
      <GeneratedValue
        value={
          !isDesktop ? (
            <>
              <Drawer
                open={foldersOpen}
                onClose={() => setFoldersOpen(false)}
                side="left"
                size="sm"
                title={tGenerated('m_1f749e388d1d74')}
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
                  onSnooze={(i) => {
                    snooze(i)
                    setSelectedId(null)
                  }}
                  onClose={() => setSelectedId(null)}
                />
              </Drawer>
            </>
          ) : null
        }
      />
    </div>
  )
}
