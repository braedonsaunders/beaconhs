import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import { cn, Skeleton } from '@beaconhs/ui'

/**
 * Full-height loading placeholder for records pages. Mirrors the real records
 * views so the shimmer matches whatever streams in: stacked <ListCard>-shaped
 * cards on phones, a sortable table on tablet/desktop. Fills the available
 * height (`min-h-full`) so a loading page doesn't read as a short card
 * floating in empty space.
 *
 *   <ListPageLayout header={…}>
 *     <RecordsSkeleton cols={7} />
 *   </ListPageLayout>
 */
export function RecordsSkeleton({
  rows = 12,
  cols = 6,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  const tGenerated = useGeneratedTranslations()
  // A small repeating pattern of column widths keeps the placeholder from
  // reading as a wall of identical bars.
  const widths = ['w-24', 'w-32', 'w-40', 'w-20', 'w-28', 'w-16', 'w-36']
  const cardCount = Math.min(rows, 7)

  return (
    <div
      role="status"
      aria-label={tGenerated('m_17c4f4b56b341b')}
      aria-busy="true"
      className={cn('h-full', className)}
    >
      {/* Phones: card placeholders matching <ListCard>. */}
      <ul className="space-y-2.5 sm:hidden">
        <GeneratedValue
          value={Array.from({ length: cardCount }).map((_, i) => (
            <li
              key={`card-${i}`}
              className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
                </div>
                <Skeleton className="mt-2 h-3 w-28" />
                <Skeleton className="mt-2 h-3 w-3/4" />
                <div className="mt-2.5 flex gap-1.5">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </div>
            </li>
          ))}
        />
      </ul>

      {/* Tablet/desktop: a table that fills the available height. */}
      <div className="hidden min-h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full caption-bottom text-sm">
          <thead className="bg-slate-50/95 shadow-[inset_0_-1px_0_rgb(226_232_240)] dark:bg-slate-900/80">
            <tr>
              <GeneratedValue
                value={Array.from({ length: cols }).map((_, i) => (
                  <th key={`h-${i}`} className="h-10 px-3 text-left align-middle">
                    <Skeleton className="h-3 w-16" />
                  </th>
                ))}
              />
            </tr>
          </thead>
          <tbody>
            <GeneratedValue
              value={Array.from({ length: rows }).map((_, r) => (
                <tr key={`r-${r}`} className="border-b border-slate-100 dark:border-slate-800">
                  <GeneratedValue
                    value={Array.from({ length: cols }).map((_, c) => {
                      const w = widths[(r + c) % widths.length]
                      const isStatus = c === 1 && r % 3 === 0
                      return (
                        <td key={`c-${r}-${c}`} className="px-3 py-3 align-middle">
                          <GeneratedValue
                            value={
                              isStatus ? (
                                <Skeleton className="h-5 w-16 rounded-full" />
                              ) : (
                                <Skeleton className={cn('h-3.5', w)} />
                              )
                            }
                          />
                        </td>
                      )
                    })}
                  />
                </tr>
              ))}
            />
          </tbody>
        </table>
      </div>
      <span className="sr-only">
        <GeneratedText id="m_0e65697ec32c03" />
      </span>
    </div>
  )
}
