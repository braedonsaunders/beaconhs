import { cn } from '@beaconhs/ui'

/**
 * One-row controls strip for list pages: search box + filter dropdowns laid
 * out inline. On desktop everything sits on a single row; on mobile the search
 * box takes the full width and the filter pills wrap beneath it. Pass
 * right-aligned extras (view toggles, secondary actions) via `trailing`.
 *
 *   <TableToolbar trailing={<ViewToggle />}>
 *     <SearchInput placeholder="Search…" />
 *     <FilterChips … />
 *     <FilterChips … />
 *   </TableToolbar>
 */
export function TableToolbar({
  children,
  trailing,
  className,
}: {
  children: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  )
}
