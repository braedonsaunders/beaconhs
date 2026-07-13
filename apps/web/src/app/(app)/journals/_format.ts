// Client-safe formatting helpers for the Journals UI.

import type { JournalStatus } from './_types'

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

/** "Fri · Jun 5" */
export function formatDate(iso: string): string {
  const d = parse(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Friday, June 5, 2026" */
export function formatLongDate(iso: string): string {
  const d = parse(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function weekdayShort(iso: string): string {
  return WD[parse(iso).getDay()] ?? ''
}

/** A Date's YYYY-MM-DD in LOCAL time — never toISOString(), which is UTC and
 *  shifts evening dates to tomorrow (or cells a day off) for non-UTC users. */
export function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export function isToday(iso: string): boolean {
  return iso === localDateISO(new Date())
}

/** "now", "5m", "2h", "3d", else date. */
export function relativeTime(isoTs: string): string {
  const then = new Date(isoTs).getTime()
  const diff = Date.now() - then
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(isoTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Render plain text (with newlines) as safe HTML paragraphs. Migrated entries
 * stored their body as plain text in `body_text`; feeding that straight into an
 * HTML surface (the read-only viewer or the TipTap editor) collapses every line
 * break. Already-HTML bodies pass through untouched.
 */
export function textToHtml(text: string | null | undefined): string {
  if (!text) return ''
  // Already HTML (editor output, or migrated rich-text) — leave as-is.
  if (/<(p|br|div|ul|ol|li|h[1-6]|blockquote)\b/i.test(text)) return text
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function statusMeta(status: JournalStatus): { label: string; className: string } {
  switch (status) {
    case 'submitted':
      return {
        label: 'Submitted',
        className:
          'bg-teal-100 text-teal-800 ring-teal-600/20 dark:bg-teal-500/15 dark:text-teal-200 dark:ring-teal-500/25',
      }
    case 'archived':
      return {
        label: 'Archived',
        className:
          'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/25',
      }
    default:
      return {
        label: 'Draft',
        className:
          'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/25',
      }
  }
}
