import { Check } from 'lucide-react'
import { cn } from '@beaconhs/ui'

/**
 * Display-only checkbox indicator for detail pages (read-only views of bool
 * fields). Use a real `<input type=checkbox>` for editable forms.
 */
export function CheckIndicator({ checked, label, className }: { checked: boolean; label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded border',
          checked ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900',
        )}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className={checked ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>{label}</span>
    </div>
  )
}
