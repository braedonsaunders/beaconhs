import * as React from 'react'
import { cn } from './utils'
import { Skeleton } from './skeleton'

/**
 * Drop-in fallback for an async table body. Renders a header strip + N rows
 * × M columns of shimmering placeholders sized to look like real text/badge
 * content. Intentionally mirrors the chrome of the real `Table` component
 * so layout doesn't jump when content swaps in.
 *
 *   <Suspense fallback={<TableSkeleton rows={10} cols={6} />}>
 *     <RecordsTable …/>
 *   </Suspense>
 */
export function TableSkeleton({
  rows = 8,
  cols = 5,
  className,
  /** Set true to omit the outer card chrome (when used inside an existing card). */
  bare = false,
}: {
  rows?: number
  cols?: number
  className?: string
  bare?: boolean
}) {
  // A small repeating pattern of column widths makes the placeholder feel
  // organic — single-width skeletons look like a wall of bars otherwise.
  const widths = ['w-24', 'w-32', 'w-40', 'w-20', 'w-28', 'w-16', 'w-36']

  const body = (
    <table className="w-full caption-bottom text-sm">
      <thead className="bg-slate-50/95 shadow-[inset_0_-1px_0_rgb(226_232_240)] dark:bg-slate-900/80">
        <tr>
          {Array.from({ length: cols }).map((_, i) => (
            <th key={`h-${i}`} className="h-10 px-3 text-left align-middle">
              <Skeleton className="h-3 w-16" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={`r-${r}`} className="border-b border-slate-100 dark:border-slate-800">
            {Array.from({ length: cols }).map((_, c) => {
              const w = widths[(r + c) % widths.length]
              const isStatus = c === 1 && r % 3 === 0
              return (
                <td key={`c-${r}-${c}`} className="px-3 py-3 align-middle">
                  {isStatus ? (
                    <Skeleton className="h-5 w-16 rounded-full" />
                  ) : (
                    <Skeleton className={cn('h-3.5', w)} />
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (bare) return <div className={className}>{body}</div>

  return (
    <div
      role="status"
      aria-label="Loading table contents"
      aria-busy="true"
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {body}
      <span className="sr-only">Loading…</span>
    </div>
  )
}
