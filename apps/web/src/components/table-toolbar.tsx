import { Children, isValidElement } from 'react'
import { GeneratedValue } from '@/i18n/generated'
import { cn } from '@beaconhs/ui'
import { SearchInput } from './search-input'

/**
 * Controls strip for list pages: search box + filter dropdowns. On desktop
 * everything sits inline on one wrapping row. On phones the search box takes
 * the full width and every filter (plus `trailing` extras such as view
 * toggles) shares ONE horizontally scrolling row beneath it, so a list with
 * six filters costs the same vertical space as a list with one.
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
  const items = Children.toArray(children)
  const isSearch = (child: React.ReactNode) => isValidElement(child) && child.type === SearchInput
  const search = items.filter(isSearch)
  // Inline range forms (dates) are the widest controls; they go last so the
  // phone's scroll row opens on the filter pills.
  const isForm = (child: React.ReactNode) => isValidElement(child) && child.type === 'form'
  const controls = [
    ...items.filter((child) => !isSearch(child) && !isForm(child)),
    ...items.filter(isForm),
  ]
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      <GeneratedValue value={search} />
      {controls.length > 0 || trailing ? (
        <div className="flex [scrollbar-width:none] items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] pr-6 *:shrink-0 sm:contents [&::-webkit-scrollbar]:hidden [&>.contents>*]:shrink-0">
          <GeneratedValue value={controls} />
          {trailing ? (
            <div className="flex items-center gap-2 sm:ml-auto">
              <GeneratedValue value={trailing} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
