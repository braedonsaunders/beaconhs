'use client'

// Card-based inbox list with cursor lazy-loading. Each notification is a
// full-width tappable card (mobile-first); unread cards carry a teal accent
// and a mark-read control. More pages stream in as the sentinel scrolls into
// view; mark-read updates optimistically.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'
import { fetchInboxPage, markNotificationRead, type InboxItem } from './actions'

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function InboxList({
  initialItems,
  initialHasMore,
}: {
  initialItems: InboxItem[]
  initialHasMore: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  // Resync when the server page re-renders (e.g. after "Mark all read").
  useEffect(() => {
    setItems(initialItems)
    setHasMore(initialHasMore)
  }, [initialItems, initialHasMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return
        loadingRef.current = true
        setLoading(true)
        try {
          const last = items[items.length - 1]
          if (!last) return
          const page = await fetchInboxPage({ occurredAt: last.occurredAt, id: last.id })
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.id))
            return [...prev, ...page.items.filter((i) => !seen.has(i.id))]
          })
          setHasMore(page.hasMore)
        } finally {
          loadingRef.current = false
          setLoading(false)
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items, hasMore])

  const markRead = (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)))
    startTransition(() => markNotificationRead(id))
  }

  const open = (item: InboxItem) => {
    if (!item.read) markRead(item.id)
    if (item.linkPath) router.push(item.linkPath as never)
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <div
              role={n.linkPath ? 'link' : undefined}
              tabIndex={n.linkPath ? 0 : undefined}
              onClick={() => open(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  open(n)
                }
              }}
              className={cn(
                'relative flex w-full gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-colors sm:p-4 dark:bg-slate-900',
                n.linkPath && 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600',
                n.read
                  ? 'border-slate-200 dark:border-slate-800'
                  : 'border-teal-200 bg-teal-50/40 dark:border-teal-900/60 dark:bg-teal-950/20',
              )}
            >
              {!n.read ? (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" aria-hidden />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      'min-w-0 text-sm break-words',
                      n.read
                        ? 'text-slate-700 dark:text-slate-200'
                        : 'font-medium text-slate-900 dark:text-slate-100',
                    )}
                  >
                    {n.title}
                  </p>
                  <time
                    suppressHydrationWarning
                    className="shrink-0 text-xs whitespace-nowrap text-slate-400 dark:text-slate-500"
                  >
                    {relativeTime(n.occurredAt)}
                  </time>
                </div>
                {n.body ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                    {n.body}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-normal capitalize">
                    {n.category.replace(/_/g, ' ')}
                  </Badge>
                  {n.isCritical ? <Badge variant="destructive">Critical</Badge> : null}
                  {!n.read ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        markRead(n.id)
                      }}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Check size={12} /> Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div ref={sentinelRef} className="flex items-center justify-center py-6">
          {loading ? (
            <Loader2 size={18} className="animate-spin text-slate-400" />
          ) : (
            <span className="text-xs text-slate-400">&nbsp;</span>
          )}
        </div>
      ) : items.length > 0 ? (
        <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
          You&rsquo;re all caught up.
        </p>
      ) : null}
    </div>
  )
}
