import { cn } from './utils'

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
  return (
    <div className={cn('space-y-2', className)}>
      {back ? (
        <a href={back.href} className="text-xs text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-300">
          ← {back.label}
        </a>
      ) : null}
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          {description ? <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
  return (
    <header className="space-y-2">
      {back ? (
        <a href={back.href} className="text-sm text-teal-700 dark:text-teal-300 hover:underline">
          ← {back.label}
        </a>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          {badge}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {subtitle ? <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
    </header>
  )
}
