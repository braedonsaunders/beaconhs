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
        <a
          href={back.href}
          className="text-xs text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
        >
          ← {back.label}
        </a>
      ) : null}
      {/* Phones stack title → description → actions; sm+ keeps the classic
          one-row header with a truncating title. */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 sm:truncate sm:text-2xl dark:text-slate-100">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
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
  return (
    <header className="space-y-2">
      {back ? (
        <a href={back.href} className="text-sm text-teal-700 hover:underline dark:text-teal-300">
          ← {back.label}
        </a>
      ) : null}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold text-slate-900 sm:truncate sm:text-2xl dark:text-slate-100">
            {title}
          </h1>
          {badge}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {subtitle ? <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
    </header>
  )
}
