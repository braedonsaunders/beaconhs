import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
// Read-only journal viewer rendered inside the records-list flyout (UrlDrawer).
// A server component — no client state, just a beautifully laid-out render of
// the authored HTML (body_html, or body_text for migrated entries) plus its
// metadata, summary, tags and photos.

import { Briefcase, MapPin } from 'lucide-react'
import { useLocale } from 'next-intl'
import { cn } from '@beaconhs/ui'
import type { AppLocale } from '@beaconhs/i18n'
import { RawImage } from '@/components/raw-image'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { tagSwatch } from '../_tag-colors'
import { formatLongDate, statusMeta, textToHtml } from '../_format'
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

function Avatar({ name, size = 44 }: { name: string | null; size?: number }) {
  const label = name?.trim() || 'Unassigned'
  const parts = label.split(/\s+/)
  const init =
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')
    ).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const color = name ? AVATAR_COLORS[h % AVATAR_COLORS.length] : 'bg-slate-300 dark:bg-slate-600'
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        color,
      )}
    >
      <GeneratedValue value={init} />
    </span>
  )
}

function fmtTimestamp(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function JournalView({
  entry,
  tagColors,
}: {
  entry: JournalEntryDetail
  tagColors: Map<string, string | null>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const locale = useLocale() as AppLocale
  const status = statusMeta(entry.status, locale)
  // Sanitise at render too (defence in depth for rows written before the
  // server-side write sanitiser existed) — never inject stored HTML raw.
  const html =
    sanitizeDocumentHtml(entry.bodyHtml || textToHtml(entry.bodyText)) ||
    '<p class="text-slate-400 dark:text-slate-500">No content recorded.</p>'

  return (
    <div className="space-y-5">
      {/* Author + status */}
      <div className="flex items-start gap-3">
        <Avatar name={entry.authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={entry.authorName ?? <GeneratedText id="m_10d1d0d92a9aaa" />} />
            </h3>
            <span
              className={cn(
                'rounded-full px-2 py-px text-[11px] font-medium ring-1 ring-inset',
                status.className,
              )}
            >
              <GeneratedValue value={status.label} />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={formatLongDate(entry.entryDate, locale)} /> ·
            <GeneratedValue value={' '} />
            <span className="font-mono">
              <GeneratedValue value={entry.reference} />
            </span>
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-y border-slate-100 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} className="text-slate-400" />{' '}
          <GeneratedValue value={entry.siteName ?? <GeneratedText id="m_1ad901c0a1f003" />} />
        </span>
        <span className="inline-flex items-center gap-1.5 capitalize">
          <Briefcase size={13} className="text-slate-400" />{' '}
          <GeneratedValue value={entry.definition} />
        </span>
        <GeneratedValue
          value={
            entry.submittedAt ? (
              <span>
                <GeneratedText id="m_0c823c3949ebd6" />{' '}
                <GeneratedValue value={fmtTimestamp(entry.submittedAt, locale)} />
              </span>
            ) : null
          }
        />
        <span>
          <GeneratedText id="m_014ca61c68ab13" />{' '}
          <GeneratedValue value={fmtTimestamp(entry.updatedAt, locale)} />
        </span>
      </div>

      <GeneratedValue
        value={
          entry.title ? (
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={entry.title} />
            </h2>
          ) : null
        }
      />

      <GeneratedValue
        value={
          entry.summary ? (
            <p className="rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-sm leading-relaxed text-slate-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-slate-200">
              <GeneratedValue value={entry.summary} />
            </p>
          ) : null
        }
      />

      <GeneratedValue
        value={
          entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <GeneratedValue
                value={entry.tags.map((t) => {
                  const sw = tagSwatch(tagColors.get(t) ?? null)
                  return (
                    <span
                      key={t}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                        sw.chip,
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', sw.dot)} />
                      <GeneratedValue value={t} />
                    </span>
                  )
                })}
              />
            </div>
          ) : null
        }
      />

      <article
        className="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <GeneratedValue
        value={
          entry.photos.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <GeneratedText id="m_0a07835d0e7c93" />
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <GeneratedValue
                  value={entry.photos.map((p) =>
                    p.url ? (
                      <figure key={p.id} className="overflow-hidden rounded-lg">
                        <RawImage
                          src={p.url}
                          alt={tGeneratedValue(p.caption ?? '')}
                          optimizationReason="authenticated"
                          loading="lazy"
                          className="h-32 w-full object-cover"
                        />
                        <GeneratedValue
                          value={
                            p.caption ? (
                              <figcaption className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={p.caption} />
                              </figcaption>
                            ) : null
                          }
                        />
                      </figure>
                    ) : null,
                  )}
                />
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}
