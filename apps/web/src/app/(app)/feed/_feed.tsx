'use client'

// The activity timeline — a wide, social-style stream of recent events
// (journals, incidents, corrective actions, forms) the viewer is allowed to see.
// Read-only. A summary rail (desktop) and filter pills sit alongside an
// infinite-scrolling column of rich cards. Fully dark-mode aware.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Layers,
  ListChecks,
  Loader2,
  MapPin,
  NotebookPen,
  Rss,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { AppLocale } from '@beaconhs/i18n'
import { RawImage } from '@/components/raw-image'
import { tagSwatch } from '../journals/_tag-colors'
import { fetchFeedPage } from './_actions'
import type { FeedEvent, FeedKind, FeedPage, FeedSummary } from './_types'

type KindMeta = {
  label: string
  plural: string
  Icon: LucideIcon
  /** Gradient for the kind badge / icon tile. */
  tile: string
  /** Small textual chip (dark-aware). */
  chip: string
  /** Direct-hover accent for links (title + footer). */
  accent: string
  /** Summary-bar fill. */
  bar: string
}

const KIND: Record<FeedKind, KindMeta> = {
  journal: {
    label: 'Journal',
    plural: 'Journals',
    Icon: NotebookPen,
    tile: 'bg-gradient-to-br from-teal-500 to-emerald-600',
    chip: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/15 dark:text-teal-200 dark:ring-teal-500/25',
    accent: 'hover:text-teal-700 dark:hover:text-teal-300',
    bar: 'bg-teal-500',
  },
  incident: {
    label: 'Incident',
    plural: 'Incidents',
    Icon: AlertTriangle,
    tile: 'bg-gradient-to-br from-rose-500 to-red-600',
    chip: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/25',
    accent: 'hover:text-rose-700 dark:hover:text-rose-300',
    bar: 'bg-rose-500',
  },
  corrective_action: {
    label: 'Corrective action',
    plural: 'Corrective actions',
    Icon: ListChecks,
    tile: 'bg-gradient-to-br from-amber-500 to-orange-600',
    chip: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/25',
    accent: 'hover:text-amber-700 dark:hover:text-amber-300',
    bar: 'bg-amber-500',
  },
  hazard_assessment: {
    label: 'Hazard assessment',
    plural: 'Hazard assessments',
    Icon: ShieldAlert,
    tile: 'bg-gradient-to-br from-sky-500 to-blue-600',
    chip: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/25',
    accent: 'hover:text-sky-700 dark:hover:text-sky-300',
    bar: 'bg-sky-500',
  },
  form: {
    label: 'App',
    plural: 'Apps',
    Icon: ClipboardCheck,
    tile: 'bg-gradient-to-br from-violet-500 to-purple-600',
    chip: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/25',
    accent: 'hover:text-violet-700 dark:hover:text-violet-300',
    bar: 'bg-violet-500',
  },
}

const KIND_ORDER: FeedKind[] = [
  'journal',
  'incident',
  'corrective_action',
  'hazard_assessment',
  'form',
]

const ICON_TINT: Record<FeedKind, string> = {
  journal: 'text-teal-500',
  incident: 'text-rose-500',
  corrective_action: 'text-amber-500',
  hazard_assessment: 'text-sky-500',
  form: 'text-violet-500',
}

type Filter = FeedKind | 'all'

const kindsFor = (f: Filter): FeedKind[] | undefined => (f === 'all' ? undefined : [f])

/** Stable no-op subscriber for the client-only `mounted` store. */
const subscribeNoop = () => () => {}

export function FeedTimeline({
  initial,
  summary,
}: {
  initial: FeedPage
  summary: FeedSummary | null
}) {
  const locale = useLocale() as AppLocale
  const [filter, setFilter] = useState<Filter>('all')
  const [events, setEvents] = useState<FeedEvent[]>(initial.events)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false) // appending the next page
  const [switching, setSwitching] = useState(false) // re-querying after a filter change
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null)

  const sentinel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const gen = useRef(0) // bumps on each filter change; stale responses are dropped

  // Day separators depend on "now" — render them only on the client so the
  // server (no browser clock/timezone) and the first client paint agree.
  // useSyncExternalStore gives `false` on the server, `true` after hydration,
  // with no effect (so no cascading-render lint warning).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor) return
    busy.current = true
    setLoading(true)
    const myGen = gen.current
    try {
      const next = await fetchFeedPage(cursor, kindsFor(filter))
      if (gen.current !== myGen) return // a filter change superseded this page
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...prev, ...next.events.filter((e) => !seen.has(e.id))]
      })
      setCursor(next.nextCursor)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [cursor, filter])

  const changeFilter = useCallback(async (next: Filter) => {
    gen.current += 1
    const myGen = gen.current
    busy.current = false
    setFilter(next)
    setSwitching(true)
    try {
      const page = await fetchFeedPage(null, kindsFor(next))
      if (gen.current !== myGen) return
      setEvents(page.events)
      setCursor(page.nextCursor)
    } finally {
      if (gen.current === myGen) setSwitching(false)
    }
  }, [])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor || switching) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '900px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, cursor, switching])

  // Lightbox keyboard navigation.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowRight')
        setLightbox((lb) => (lb ? { ...lb, index: (lb.index + 1) % lb.urls.length } : lb))
      else if (e.key === 'ArrowLeft')
        setLightbox((lb) =>
          lb ? { ...lb, index: (lb.index - 1 + lb.urls.length) % lb.urls.length } : lb,
        )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const rendered = useMemo(() => {
    const out: React.ReactNode[] = []
    let lastBucket = ''
    for (const e of events) {
      if (mounted) {
        const b = dayBucket(e.at, locale)
        if (b !== lastBucket) {
          out.push(<DaySeparator key={`sep-${b}-${e.id}`} label={b} />)
          lastBucket = b
        }
      }
      out.push(
        <FeedCard
          key={e.id}
          event={e}
          locale={locale}
          onOpenPhotos={(urls, i) => setLightbox({ urls, index: i })}
        />,
      )
    }
    return out
  }, [events, locale, mounted])

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* The app shell's own sidebar (w-60 at lg) eats horizontal room, so the
          two-column feed + rail only kicks in at xl — below that the feed is a
          single, comfortably-capped column. */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
        {/* Main column */}
        <div className="mx-auto w-full max-w-3xl min-w-0 xl:mx-0 xl:max-w-none">
          <FilterBar filter={filter} summary={summary} onChange={changeFilter} busy={switching} />

          {switching ? (
            <FeedSkeleton />
          ) : events.length === 0 ? (
            <EmptyFeed filter={filter} onClear={() => changeFilter('all')} />
          ) : (
            <div className="space-y-3 sm:space-y-4">{rendered}</div>
          )}

          <div ref={sentinel} aria-hidden className="h-px" />

          {!switching && loading ? (
            <LoadingMore />
          ) : !switching && !cursor && events.length > 0 ? (
            <EndOfFeed />
          ) : null}
        </div>

        {/* Summary rail (desktop) */}
        <FeedRail summary={summary} filter={filter} onChange={changeFilter} />
      </div>

      {lightbox ? (
        <Lightbox
          state={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
        />
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Filter pills (sticky)
 * ------------------------------------------------------------------------- */

function FilterBar({
  filter,
  summary,
  onChange,
  busy,
}: {
  filter: Filter
  summary: FeedSummary | null
  onChange: (f: Filter) => void
  busy: boolean
}) {
  const pills: { key: Filter; label: string; count?: number; Icon: LucideIcon }[] = [
    { key: 'all', label: 'All', count: summary?.total, Icon: Layers },
    ...KIND_ORDER.map((k) => ({
      key: k as Filter,
      label: KIND[k].label,
      count: summary?.byKind[k],
      Icon: KIND[k].Icon,
    })),
  ]

  return (
    <div className="sticky top-0 z-20 -mt-1 mb-3 bg-slate-50/90 pt-1 pb-2 backdrop-blur-md dark:bg-slate-950/85">
      <div className="app-scroll flex items-center gap-2 overflow-x-auto pb-0.5">
        {pills.map((p) => {
          const active = filter === p.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              disabled={busy}
              aria-pressed={active}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:opacity-60',
                active
                  ? 'border-transparent bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white',
              )}
            >
              <p.Icon
                size={14}
                className={cn(
                  active
                    ? ''
                    : p.key !== 'all'
                      ? ICON_TINT[p.key]
                      : 'text-slate-400 dark:text-slate-500',
                )}
              />
              {p.label}
              {typeof p.count === 'number' ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                    active
                      ? 'bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  )}
                >
                  {p.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Summary rail
 * ------------------------------------------------------------------------- */

function FeedRail({
  summary,
  filter,
  onChange,
}: {
  summary: FeedSummary | null
  filter: Filter
  onChange: (f: Filter) => void
}) {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-2 space-y-4">
        {summary ? <SummaryCard summary={summary} filter={filter} onChange={onChange} /> : null}
        <LegendCard />
      </div>
    </aside>
  )
}

function SummaryCard({
  summary,
  filter,
  onChange,
}: {
  summary: FeedSummary
  filter: Filter
  onChange: (f: Filter) => void
}) {
  const max = Math.max(1, ...KIND_ORDER.map((k) => summary.byKind[k]))
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Last 7 days</h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">activity</span>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">
          {summary.total}
        </span>
        <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">events</span>
      </div>
      {summary.today > 0 ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {summary.today} in the last 24 hours
        </p>
      ) : null}

      <div className="mt-4 space-y-1">
        {KIND_ORDER.map((k) => {
          const meta = KIND[k]
          const v = summary.byKind[k]
          const active = filter === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(active ? 'all' : k)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                active
                  ? 'bg-slate-100 dark:bg-slate-800'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              )}
            >
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white shadow-sm',
                  meta.tile,
                )}
              >
                <meta.Icon size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                    {meta.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {v}
                  </span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/50">
                  <span
                    className={cn(
                      'block h-full rounded-full transition-all duration-500',
                      meta.bar,
                    )}
                    style={{ width: `${Math.round((v / max) * 100)}%` }}
                  />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LegendCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        What you're seeing
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Recent activity across the organisation. Scoped to what your role can access.
      </p>
      <ul className="mt-3 space-y-2">
        {KIND_ORDER.map((k) => {
          const meta = KIND[k]
          return (
            <li
              key={k}
              className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300"
            >
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-white',
                  meta.tile,
                )}
              >
                <meta.Icon size={12} />
              </span>
              {meta.plural}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Card
 * ------------------------------------------------------------------------- */

function FeedCard({
  event,
  locale,
  onOpenPhotos,
}: {
  event: FeedEvent
  locale: AppLocale
  onOpenPhotos: (urls: string[], index: number) => void
}) {
  const k = KIND[event.kind]
  const actor = event.actorName || 'Someone'
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar name={actor} kind={event.kind} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[15px] leading-snug text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{actor}</span>{' '}
              <span className="text-slate-500 dark:text-slate-400">{event.action}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset',
                  k.chip,
                )}
              >
                <k.Icon size={11} /> {k.label}
              </span>
              <time suppressHydrationWarning dateTime={event.at}>
                {timeAgo(event.at, locale)}
              </time>
              {event.siteName ? (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden>·</span>
                  <MapPin size={11} /> {event.siteName}
                </span>
              ) : null}
            </div>
          </div>
          {event.badge ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70 ring-inset dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
              {event.badge}
            </span>
          ) : null}
        </div>

        {/* Body */}
        <div className="mt-3">
          <Link
            href={event.href as never}
            className={cn(
              'text-[17px] leading-snug font-semibold text-slate-900 transition-colors dark:text-slate-100',
              k.accent,
            )}
          >
            {event.title}
          </Link>
          {event.snippet ? (
            <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {event.snippet}
            </p>
          ) : null}

          {event.tags && event.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
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
            <PhotoGrid
              urls={event.photoUrls}
              total={event.photoCount ?? event.photoUrls.length}
              onOpen={(i) => onOpenPhotos(event.photoUrls!, i)}
            />
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <Link
        href={event.href as never}
        className={cn(
          'flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 sm:px-5 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/50',
          k.accent,
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <k.Icon size={13} /> Open {k.label.toLowerCase()}
        </span>
        <ArrowRight size={13} className="opacity-60" />
      </Link>
    </article>
  )
}

/* ----------------------------------------------------------------------------
 * Photos
 * ------------------------------------------------------------------------- */

function PhotoGrid({
  urls,
  total,
  onOpen,
}: {
  urls: string[]
  total: number
  onOpen: (index: number) => void
}) {
  const shown = urls.slice(0, 4)
  const n = shown.length
  const extra = total - n
  if (n === 0) return null

  const cell = (u: string, i: number, cls: string) => (
    <button
      key={i}
      type="button"
      onClick={() => onOpen(i)}
      className={cn('group/photo relative overflow-hidden bg-slate-100 dark:bg-slate-800', cls)}
    >
      <RawImage
        src={u}
        alt=""
        optimizationReason="authenticated"
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-300 group-hover/photo:scale-105"
      />
      {i === 3 && extra > 0 ? (
        <span className="absolute inset-0 grid place-items-center bg-slate-950/55 text-xl font-semibold text-white backdrop-blur-[1px]">
          +{extra}
        </span>
      ) : null}
    </button>
  )

  const ring = 'mt-3 overflow-hidden rounded-xl ring-1 ring-slate-200/70 dark:ring-slate-800'

  if (n === 1) return <div className={ring}>{cell(shown[0]!, 0, 'h-72 w-full sm:h-80')}</div>
  if (n === 2)
    return (
      <div className={cn(ring, 'grid grid-cols-2 gap-1')}>
        {shown.map((u, i) => cell(u, i, 'h-56'))}
      </div>
    )
  if (n === 3)
    return (
      <div className={cn(ring, 'grid grid-cols-2 grid-rows-2 gap-1')}>
        {cell(shown[0]!, 0, 'col-span-2 h-52')}
        {cell(shown[1]!, 1, 'h-40')}
        {cell(shown[2]!, 2, 'h-40')}
      </div>
    )
  return (
    <div className={cn(ring, 'grid grid-cols-2 gap-1')}>
      {shown.map((u, i) => cell(u, i, 'h-40'))}
    </div>
  )
}

function Lightbox({
  state,
  onClose,
  onIndex,
}: {
  state: { urls: string[]; index: number }
  onClose: () => void
  onIndex: (index: number) => void
}) {
  const { urls, index } = state
  const many = urls.length > 1
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <X size={20} />
      </button>
      {many ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index - 1 + urls.length) % urls.length)
            }}
            aria-label="Previous"
            className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:left-6"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index + 1) % urls.length)
            }}
            aria-label="Next"
            className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:right-6"
          >
            <ChevronRight size={22} />
          </button>
        </>
      ) : null}
      <RawImage
        src={urls[index]!}
        alt=""
        optimizationReason="authenticated"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
      {many ? (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/90 tabular-nums">
          {index + 1} / {urls.length}
        </div>
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Avatar
 * ------------------------------------------------------------------------- */

const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-orange-500 to-amber-600',
  'from-amber-500 to-yellow-600',
  'from-emerald-500 to-teal-600',
  'from-teal-500 to-cyan-600',
  'from-sky-500 to-blue-600',
  'from-indigo-500 to-violet-600',
  'from-violet-500 to-purple-600',
  'from-fuchsia-500 to-pink-600',
]

function Avatar({ name, kind }: { name: string; kind: FeedKind }) {
  const parts = name.trim().split(/\s+/)
  const init =
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')
    ).toUpperCase() || '•'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const grad = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
  const meta = KIND[kind]
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          'grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10',
          grad,
        )}
      >
        {init}
      </span>
      <span
        className={cn(
          'absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full text-white ring-2 ring-white dark:ring-slate-900',
          meta.tile,
        )}
      >
        <meta.Icon size={11} />
      </span>
    </span>
  )
}

/* ----------------------------------------------------------------------------
 * States & helpers
 * ------------------------------------------------------------------------- */

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1 first:pt-0">
      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent dark:from-slate-800" />
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 sm:space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70" />
          </div>
        </div>
      ))}
    </div>
  )
}

function LoadingMore() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400 dark:text-slate-500">
      <Loader2 size={15} className="animate-spin" /> Loading more…
    </div>
  )
}

function EndOfFeed() {
  return (
    <div className="flex flex-col items-center gap-1.5 py-10 text-center">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
      <p className="text-xs font-medium text-slate-400 dark:text-slate-500">You're all caught up</p>
    </div>
  )
}

function EmptyFeed({ filter, onClear }: { filter: Filter; onClear: () => void }) {
  if (filter === 'all') {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 px-6 py-20 text-center dark:border-slate-800 dark:bg-slate-900/40">
        <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 shadow-inner ring-1 ring-slate-200/60 dark:from-slate-800 dark:to-slate-900 dark:text-slate-500 dark:ring-slate-700/60">
          <Rss size={28} />
        </span>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          No activity yet
        </h2>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Journals, incidents, corrective actions, hazard assessments, and forms appear here as your
          team works.
        </p>
      </div>
    )
  }
  const meta = KIND[filter]
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 px-6 py-20 text-center dark:border-slate-800 dark:bg-slate-900/40">
      <span
        className={cn(
          'mb-4 grid h-16 w-16 place-items-center rounded-2xl text-white shadow-sm',
          meta.tile,
        )}
      >
        <meta.Icon size={28} />
      </span>
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        No {meta.plural.toLowerCase()} yet
      </h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Nothing of this type in range. Switch types or view everything.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <Layers size={14} /> Show all activity
      </button>
    </div>
  )
}

function timeAgo(iso: string, locale: AppLocale): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(sec)
  if (abs < 45) return rtf.format(0, 'second')
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  const hr = Math.round(min / 60)
  if (Math.abs(hr) < 24) return rtf.format(hr, 'hour')
  const day = Math.round(hr / 24)
  if (Math.abs(day) < 7) return rtf.format(day, 'day')
  const wk = Math.round(day / 7)
  if (Math.abs(wk) < 5) return rtf.format(wk, 'week')
  const mo = Math.round(day / 30)
  if (Math.abs(mo) < 12) return rtf.format(mo, 'month')
  return rtf.format(Math.round(day / 365), 'year')
}

function dayBucket(iso: string, locale: AppLocale): string {
  const d = new Date(iso)
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (days <= 0) return relative.format(0, 'day')
  if (days === 1) return relative.format(-1, 'day')
  if (days < 7) return d.toLocaleDateString(locale, { weekday: 'long' })
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(locale, { month: 'long', day: 'numeric' })
  return d.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })
}
