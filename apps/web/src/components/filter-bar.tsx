import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { mergeHref } from '@/lib/list-params'

export type FilterOption = { value: string; label: string; count?: number }

/**
 * Set of clickable chips that filter the list by a single param.
 * Active chip is the highlighted variant.
 */
export function FilterChips({
  basePath,
  currentParams,
  paramKey,
  label,
  options,
  allLabel = 'All',
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  paramKey: string
  label: string
  options: FilterOption[]
  allLabel?: string
}) {
  const current = typeof currentParams[paramKey] === 'string' ? (currentParams[paramKey] as string) : undefined

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium uppercase tracking-wide text-slate-500">{label}:</span>
      <ChipLink
        href={mergeHref(basePath, currentParams, { [paramKey]: undefined, page: 1 })}
        active={!current}
      >
        {allLabel}
      </ChipLink>
      {options.map((opt) => (
        <ChipLink
          key={opt.value}
          href={mergeHref(basePath, currentParams, { [paramKey]: opt.value, page: 1 })}
          active={current === opt.value}
        >
          {opt.label}
          {typeof opt.count === 'number' ? (
            <Badge variant="secondary" className="ml-1.5">
              {opt.count}
            </Badge>
          ) : null}
        </ChipLink>
      ))}
    </div>
  )
}

function ChipLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href as any}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-teal-700 bg-teal-700 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </Link>
  )
}
