'use client'

// Read-only entry viewer for the records browser — shown in the Split view's
// right pane and as a slide-over from the Table / Card views. Renders the
// authored HTML (body_html, or body_text for migrated entries) plus metadata.

import Link from 'next/link'
import { Briefcase, Loader2, MapPin, PenLine, X } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { tagSwatch } from '../_tag-colors'
import { formatLongDate, statusMeta } from '../_format'
import type { JournalEntryDetail } from '../_types'

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

export function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  const label = name?.trim() || 'Unassigned'
  const parts = label.split(/\s+/)
  const init =
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')
    ).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const color = name ? AVATAR_COLORS[h % AVATAR_COLORS.length] : 'bg-slate-300'
  return (
    <span
      title={label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        color,
      )}
    >
      {init}
    </span>
  )
}

export function RecordReader({
  entry,
  loading,
  tagColors,
  onClose,
}: {
  entry: JournalEntryDetail | null
  loading?: boolean
  tagColors?: Map<string, string | null>
  onClose?: () => void
}) {
  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-slate-400">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }
  if (!entry) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-400">
        Select an entry to read it here.
      </div>
    )
  }
  const status = statusMeta(entry.status)
  const html = entry.bodyHtml || entry.bodyText || '<p class="text-slate-400">No content.</p>'

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
        <Avatar name={entry.authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-slate-900">
              {entry.authorName ?? 'Unassigned'}
            </h2>
            <span
              className={cn(
                'rounded-full px-2 py-px text-[10px] font-medium ring-1 ring-inset',
                status.className,
              )}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {formatLongDate(entry.entryDate)} · <span className="font-mono">{entry.reference}</span>
          </div>
        </div>
        <Link
          href={`/journals/${entry.id}` as never}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title="Open in editor"
        >
          <PenLine size={13} /> Open
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} /> {entry.siteName ?? 'No site'}
          </span>
          <span className="inline-flex items-center gap-1 capitalize">
            <Briefcase size={12} /> {entry.definition}
          </span>
        </div>

        {entry.summary ? (
          <p className="mb-3 rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-sm leading-relaxed text-slate-600">
            {entry.summary}
          </p>
        ) : null}

        {entry.tags.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {entry.tags.map((t) => {
              const sw = tagSwatch(tagColors?.get(t) ?? null)
              return (
                <span
                  key={t}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                    sw.chip,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', sw.dot)} />
                  {t}
                </span>
              )
            })}
          </div>
        ) : null}

        {/* eslint-disable-next-line react/no-danger */}
        <div
          className="prose prose-slate max-w-none text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {entry.photos.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {entry.photos.map((p) =>
              p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id}
                  src={p.url}
                  alt={p.caption ?? ''}
                  loading="lazy"
                  className="h-28 w-full rounded-lg object-cover"
                />
              ) : null,
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
