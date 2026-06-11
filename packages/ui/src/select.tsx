import * as React from 'react'
import { cn } from './utils'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

// Custom chevron — `appearance: none` drops the native control chrome (which
// clips the value text at smaller heights on macOS) and gives us consistent,
// non-clipping rendering. `pr-9` leaves room for the chevron.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")"

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, style, ...props }, ref) => (
    <select
      ref={ref}
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.65rem center',
        backgroundSize: '0.7rem',
        // Inline so it survives tailwind-merge: any caller passing a `text-*`
        // size override silently strips `leading-*` utilities (font-size and
        // leading share a tw-merge conflict group), which re-introduced the
        // clipped-descender bug at small heights. line-height:normal keeps the
        // value text vertically sane at every h-* / text-* combination.
        lineHeight: 'normal',
        ...style,
      }}
      className={cn(
        // NOTE: `block`, not `flex` — a <select> as a flex container breaks the
        // browser's native vertical centering of the value text.
        'block h-10 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
        'transition-shadow duration-150',
        'focus:border-teal-500 focus:ring-2 focus:ring-teal-500/40 focus:ring-offset-0 focus:outline-none',
        'focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50 dark:disabled:bg-slate-800',
        'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-500 aria-[invalid=true]:focus:ring-red-500/30',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'
