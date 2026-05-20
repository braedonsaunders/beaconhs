import * as React from 'react'
import { cn } from './utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400',
        'transition-shadow duration-150',
        'focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/40 focus:ring-offset-0',
        'focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/40',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50',
        'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-500 aria-[invalid=true]:focus:ring-red-500/30',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
