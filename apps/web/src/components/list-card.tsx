import Link from 'next/link'
import type { ReactNode } from 'react'
import { User } from 'lucide-react'
import { cn } from '@beaconhs/ui'

// Shared mobile list pattern. Pair a <MobileCardList> (phones only) with a
// `hidden sm:block` wrapper around the existing <Table>/<table> so phones get
// tappable cards and tablet/desktop keep the sortable table — one data source,
// two presentations. Canonical reference: hazard-assessments/_list.tsx.

export function MobileCardList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <ul className={cn('space-y-2.5 sm:hidden', className)}>{children}</ul>
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

/** Initials avatar for the person a record belongs to. */
function Avatar({ name }: { name: string | null }) {
  const label = name?.trim() || 'Unassigned'
  const parts = label.split(/\s+/)
  const init =
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const color = name ? AVATAR_COLORS[h % AVATAR_COLORS.length] : 'bg-slate-300'
  return (
    <span
      title={label}
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white',
        color,
      )}
    >
      {init}
    </span>
  )
}

/** Strip HTML tags + decode common entities to a single-line plain string —
 *  migrated rich-text fields sometimes carry markup, and a card must show text,
 *  never raw `<p>`/`<br>`. Non-string nodes (badges, JSX) pass through. */
function toPlain(node: ReactNode): ReactNode {
  if (typeof node !== 'string') return node
  if (!/[<&]/.test(node)) return node
  return node
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** One record as a premium, tappable card. Slots mirror a typical list row. */
export function ListCard({
  href,
  leading,
  person,
  avatarName,
  reference,
  status,
  title,
  meta,
  footer,
}: {
  /** Tapping the card body opens this route. */
  href?: string
  /** Control kept OUTSIDE the link (e.g. a bulk-select checkbox). */
  leading?: ReactNode
  /** The human this record belongs to — renders an avatar + a name line. */
  person?: string | null
  /** Avatar source when the title already names the person (no extra name line). */
  avatarName?: string | null
  /** Monospace identifier shown above the title (e.g. a reference number). */
  reference?: ReactNode
  /** Status pill shown top-right. */
  status?: ReactNode
  /** Primary line — the record's name/title. */
  title: ReactNode
  /** Muted secondary line (date · site · …). */
  meta?: ReactNode
  /** Trailing chips row (severity, tags, risk score …). */
  footer?: ReactNode
}) {
  const showAvatar = person !== undefined || avatarName != null
  const avatar = avatarName !== undefined ? avatarName : (person ?? null)

  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {reference ? (
            <div className="truncate font-mono text-[11px] font-semibold tracking-wide text-teal-700 dark:text-teal-400">
              {toPlain(reference)}
            </div>
          ) : null}
          <div className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {toPlain(title)}
          </div>
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {person !== undefined ? (
        <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <User size={12} className="shrink-0 text-slate-400" />
          <span className="truncate">{person?.trim() || 'Unassigned'}</span>
        </div>
      ) : null}
      {meta ? (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{toPlain(meta)}</div>
      ) : null}
      {footer ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{footer}</div> : null}
    </div>
  )

  const shell =
    'flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900'

  const content = (
    <>
      {showAvatar ? <Avatar name={avatar} /> : null}
      {body}
    </>
  )

  // A leading control (checkbox) sits outside the link so its taps don't navigate.
  if (leading) {
    return (
      <li className={cn(shell, 'items-start')}>
        <div className="pt-0.5">{leading}</div>
        {href ? (
          <Link href={href as any} className="flex min-w-0 flex-1 gap-3 active:opacity-70">
            {content}
          </Link>
        ) : (
          content
        )}
      </li>
    )
  }

  return (
    <li>
      {href ? (
        <Link href={href as any} className={cn(shell, 'active:bg-slate-50 dark:active:bg-slate-800')}>
          {content}
        </Link>
      ) : (
        <div className={shell}>{content}</div>
      )}
    </li>
  )
}
