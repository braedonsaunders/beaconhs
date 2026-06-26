// Bespoke lesson-content renderer — native to training, shared by the Studio
// preview and the learner Player. Dependency-free and XSS-safe: rich text is
// markdown-lite that is HTML-escaped FIRST, so only the tags we emit survive.

import type { LessonBlock } from '@beaconhs/db/schema'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(escaped: string): string {
  let s = escaped
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-teal-700 underline">$1</a>',
  )
  return s
}

/** Render markdown-lite → safe HTML. Author input is escaped before any tag is
 *  emitted, so stored HTML can never execute. Supports **bold**, *italic*,
 *  [links](https://…), `- ` bullet lists, and paragraphs. */
export function renderMd(md: string): string {
  const lines = escapeHtml(md ?? '').split(/\r?\n/)
  const out: string[] = []
  let listOpen = false
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) {
        out.push('<ul class="list-disc space-y-1 pl-5">')
        listOpen = true
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return out.join('\n')
}

export function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return url
}

const UNAVAILABLE =
  'rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500'

/** Server-safe (no hooks) renderer for a lesson's bespoke content blocks. */
export function LessonBlocksView({
  blocks,
  attachmentUrls = {},
}: {
  blocks: LessonBlock[]
  attachmentUrls?: Record<string, string | null | undefined>
}) {
  if (!blocks || blocks.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">No content.</p>
  }
  return (
    <div className="space-y-4">
      {blocks.map((b) => {
        switch (b.type) {
          case 'heading': {
            const cls =
              b.level === 1
                ? 'text-2xl font-bold text-slate-900 dark:text-slate-100'
                : b.level === 2
                  ? 'text-xl font-semibold text-slate-900 dark:text-slate-100'
                  : 'text-lg font-semibold text-slate-800 dark:text-slate-200'
            return (
              <p key={b.id} className={cls}>
                {b.text}
              </p>
            )
          }
          case 'text':
            return (
              <div
                key={b.id}
                className="space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                dangerouslySetInnerHTML={{ __html: renderMd(b.md) }}
              />
            )
          case 'callout': {
            const tone =
              b.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200'
                : b.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : b.tone === 'danger'
                    ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200'
                    : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200'
            return (
              <div
                key={b.id}
                className={`space-y-2 rounded-lg border px-4 py-3 text-sm ${tone}`}
                dangerouslySetInnerHTML={{ __html: renderMd(b.md) }}
              />
            )
          }
          case 'image': {
            const url = attachmentUrls[b.attachmentId]
            return url ? (
              <figure key={b.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={b.alt ?? ''}
                  className="max-w-full rounded-lg border border-slate-200 dark:border-slate-800"
                />
                {b.caption ? (
                  <figcaption className="text-xs text-slate-500 dark:text-slate-400">
                    {b.caption}
                  </figcaption>
                ) : null}
              </figure>
            ) : (
              <div key={b.id} className={UNAVAILABLE}>
                Image unavailable
              </div>
            )
          }
          case 'video': {
            const url = b.url ?? (b.attachmentId ? attachmentUrls[b.attachmentId] : null)
            if (!url)
              return (
                <div key={b.id} className={UNAVAILABLE}>
                  Video unavailable
                </div>
              )
            const isHosted = /youtube|youtu\.be|vimeo/.test(url)
            return isHosted ? (
              <div
                key={b.id}
                className="aspect-video overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
              >
                <iframe
                  src={toEmbedUrl(url)}
                  className="h-full w-full"
                  allowFullScreen
                  title={b.caption ?? 'Video'}
                />
              </div>
            ) : (
              <video
                key={b.id}
                src={url}
                controls
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800"
              />
            )
          }
          case 'file': {
            const url = attachmentUrls[b.attachmentId]
            return (
              <a
                key={b.id}
                href={url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-800 hover:border-teal-300 hover:text-teal-700 dark:border-slate-800 dark:text-slate-200 dark:hover:border-teal-700 dark:hover:text-teal-300"
              >
                <span aria-hidden>📎</span>
                {b.label ?? 'Download file'}
              </a>
            )
          }
          case 'embed':
            return (
              <div
                key={b.id}
                className="aspect-video overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
              >
                <iframe
                  src={toEmbedUrl(b.url)}
                  className="h-full w-full"
                  allowFullScreen
                  title={b.caption ?? 'Embedded content'}
                />
              </div>
            )
          case 'divider':
            return <hr key={b.id} className="border-slate-200 dark:border-slate-800" />
          default:
            return null
        }
      })}
    </div>
  )
}
