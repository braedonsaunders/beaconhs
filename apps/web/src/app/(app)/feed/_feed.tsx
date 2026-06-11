'use client'

// The activity timeline — a Facebook-style, infinite-scrolling column of recent
// events (journals, incidents, corrective actions, forms) the viewer is allowed
// to see. Read-only. New pages load as a sentinel scrolls into view.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  ListChecks,
  Loader2,
  MapPin,
  NotebookPen,
  Rss,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { tagSwatch } from '../journals/_tag-colors'
import { fetchFeedPage } from './_actions'
import type { FeedEvent, FeedKind, FeedPage } from './_types'

const KIND: Record<FeedKind, { label: string; Icon: LucideIcon; dot: string; chip: string }> = {
  journal: {
    label: 'Journal',
    Icon: NotebookPen,
    dot: 'bg-teal-500',
    chip: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  },
  incident: {
    label: 'Incident',
    Icon: AlertTriangle,
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  },
  corrective_action: {
    label: 'Corrective action',
    Icon: ListChecks,
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  },
  form: {
    label: 'Form',
    Icon: ClipboardCheck,
    dot: 'bg-violet-500',
    chip: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  },
}

export function FeedTimeline({ initial }: { initial: FeedPage }) {
  const [events, setEvents] = useState<FeedEvent[]>(initial.events)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor) return
    busy.current = true
    setLoading(true)
    try {
      const next = await fetchFeedPage(cursor)
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...prev, ...next.events.filter((e) => !seen.has(e.id))]
      })
      setCursor(next.nextCursor)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [cursor])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '700px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, cursor])

  if (events.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-teal-50 text-teal-600">
          <Rss size={28} />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Nothing here yet</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          As people submit journals, report incidents, raise corrective actions, and complete forms,
          they’ll show up here — filtered to what you’re allowed to see.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 py-6 sm:px-0">
      {events.map((e) => (
        <FeedCard key={e.id} event={e} />
      ))}

      <div ref={sentinel} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Loading more…
        </div>
      ) : !cursor ? (
        <div className="py-8 text-center text-xs text-slate-400">You’re all caught up.</div>
      ) : null}
    </div>
  )
}

function FeedCard({ event }: { event: FeedEvent }) {
  const k = KIND[event.kind]
  const actor = event.actorName || 'Someone'
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar name={actor} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-slate-800">
              <span className="font-semibold text-slate-900">{actor}</span>{' '}
              <span className="text-slate-500">{event.action}</span>
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className={cn('h-1.5 w-1.5 rounded-full', k.dot)} />
                {k.label}
              </span>
              <span>·</span>
              <time suppressHydrationWarning dateTime={event.at}>
                {timeAgo(event.at)}
              </time>
              {event.siteName ? (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin size={11} /> {event.siteName}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          {event.badge ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {event.badge}
            </span>
          ) : null}
        </div>

        {/* Body */}
        <div className="mt-3">
          <Link
            href={event.href as never}
            className="text-[15px] font-semibold text-slate-900 hover:text-teal-700 hover:underline"
          >
            {event.title}
          </Link>
          {event.snippet ? (
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-600">
              {event.snippet}
            </p>
          ) : null}

          {event.tags && event.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {event.tags.map((t) => {
                const sw = tagSwatch(t.color)
                return (
                  <span
                    key={t.name}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      sw.chip,
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', sw.dot)} />
                    {t.name}
                  </span>
                )
              })}
            </div>
          ) : null}

          {event.photoUrls && event.photoUrls.length > 0 ? (
            <PhotoGrid urls={event.photoUrls} total={event.photoCount ?? event.photoUrls.length} />
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <Link
        href={event.href as never}
        className="flex items-center gap-1 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 sm:px-5"
      >
        Open {k.label.toLowerCase()} <ArrowRight size={13} />
      </Link>
    </article>
  )
}

function PhotoGrid({ urls, total }: { urls: string[]; total: number }) {
  const shown = urls.slice(0, 4)
  const extra = total - shown.length
  return (
    <div
      className={cn(
        'mt-3 grid gap-1 overflow-hidden rounded-xl',
        shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
      )}
    >
      {shown.map((u, i) => (
        <div key={i} className={cn('relative bg-slate-100', shown.length === 1 ? 'h-72' : 'h-40')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
          {i === 3 && extra > 0 ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-900/55 text-lg font-semibold text-white">
              +{extra}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-pink-500',
]

function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/)
  const init =
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')
    ).toUpperCase() || '•'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length]
  return (
    <span
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white',
        color,
      )}
    >
      {init}
    </span>
  )
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function timeAgo(iso: string): string {
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(sec)
  if (abs < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return RTF.format(min, 'minute')
  const hr = Math.round(min / 60)
  if (Math.abs(hr) < 24) return RTF.format(hr, 'hour')
  const day = Math.round(hr / 24)
  if (Math.abs(day) < 7) return RTF.format(day, 'day')
  const wk = Math.round(day / 7)
  if (Math.abs(wk) < 5) return RTF.format(wk, 'week')
  const mo = Math.round(day / 30)
  if (Math.abs(mo) < 12) return RTF.format(mo, 'month')
  return RTF.format(Math.round(day / 365), 'year')
}
