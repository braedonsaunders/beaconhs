'use client'

// UiLink rather than a bare <a>: back-links are in-app routes, and a plain
// anchor forces a full document reload — which replays the boot splash and
// refetches the whole shell on every record → list hop. The app injects its
// client-side Link via UiLinkProvider (see link-context.tsx).
import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { UiBackLink } from './link-context'
import { useUiText } from './text-context'
import { cn } from './utils'

/**
 * Split header actions into the primary (last) action and the rest. Call sites
 * pass actions as siblings, a fragment, a plain layout `<div>`, or wrapped in
 * a value-only translation wrapper (`<GeneratedValue value={cond ? … : null}>`);
 * all of these flatten to the same list — with permission-gated `null`s
 * dropped — so the phone layout can keep the primary action on the title row
 * and fold the rest behind **More**.
 */
function flattenActions(node: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: React.ReactNode }>(child)) {
      return [child]
    }
    if (child.type === 'div') return flattenActions(child.props.children)
    const keys = Object.keys(child.props)
    if (keys.length === 1 && keys[0] === 'value') return flattenActions(child.props.value)
    return [child]
  })
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  back?: { href: string; label: string }
  className?: string
}) {
  const t = useUiText()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const items = actions ? flattenActions(actions) : []
  const primary = items.at(-1)
  const secondary = items.slice(0, -1)
  return (
    <div className={cn('space-y-2', className)}>
      {back ? (
        <UiBackLink
          href={back.href}
          label={t(back.label)}
          className="text-xs text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
        />
      ) : null}
      {/* Phones: title, primary action and a More toggle share one row; the
          secondary actions open on a second row only when asked for. sm+:
          title left, every action right, description below the title. */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2 sm:items-end sm:gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0 space-y-1">
          <h1 className="truncate text-lg font-semibold text-slate-900 sm:text-2xl dark:text-slate-100">
            {t(title)}
          </h1>
          {description ? (
            <p className="hidden text-sm text-slate-500 sm:block dark:text-slate-400">
              {t(description)}
            </p>
          ) : null}
        </div>
        {secondary.length > 0 ? (
          <div
            className={cn(
              'col-span-3 row-start-2 flex-wrap items-center justify-end gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:flex',
              moreOpen ? 'flex' : 'hidden',
            )}
          >
            {secondary}
          </div>
        ) : null}
        {primary ? (
          <div className="col-start-2 row-start-1 flex items-center justify-end sm:col-start-3 max-sm:[&_a.inline-flex]:h-9 max-sm:[&_a.inline-flex]:px-3 max-sm:[&_button]:h-9 max-sm:[&_button]:px-3">
            {primary}
          </div>
        ) : null}
        {secondary.length > 0 ? (
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-label={t('More actions')}
            onClick={() => setMoreOpen((open) => !open)}
            className={cn(
              'col-start-3 row-start-1 inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors sm:hidden',
              moreOpen
                ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            <MoreHorizontal size={16} />
          </button>
        ) : null}
      </header>
    </div>
  )
}

export function DetailHeader({
  back,
  title,
  subtitle,
  badge,
  actions,
}: {
  back?: { href: string; label: string }
  title: string
  subtitle?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}) {
  const t = useUiText()
  return (
    <header className="space-y-2">
      {back ? (
        <UiBackLink
          href={back.href}
          label={t(back.label)}
          className="text-sm text-teal-700 hover:underline dark:text-teal-300"
        />
      ) : null}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold text-slate-900 sm:truncate sm:text-2xl dark:text-slate-100">
            {t(title)}
          </h1>
          {badge}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {subtitle ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t(subtitle)}</p>
      ) : null}
    </header>
  )
}
