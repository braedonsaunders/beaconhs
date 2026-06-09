import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from '@beaconhs/ui'
import { mergeHref } from '@/lib/list-params'

export function SortableTh({
  basePath,
  currentParams,
  column,
  active,
  dir,
  className,
  children,
  align = 'left',
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  column: string
  active: boolean
  dir: 'asc' | 'desc'
  className?: string
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const nextDir: 'asc' | 'desc' = active && dir === 'asc' ? 'desc' : 'asc'
  const href = mergeHref(basePath, currentParams, { sort: column, dir: nextDir, page: 1 })
  return (
    <TableHead className={className}>
      <Link
        href={href as any}
        className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''} hover:text-slate-900 dark:hover:text-slate-100`}
      >
        {children}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp size={12} className="text-slate-700 dark:text-slate-200" />
          ) : (
            <ArrowDown size={12} className="text-slate-700 dark:text-slate-200" />
          )
        ) : (
          <ArrowUpDown size={12} className="text-slate-300" />
        )}
      </Link>
    </TableHead>
  )
}
