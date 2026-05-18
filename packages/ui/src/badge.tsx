import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-teal-100 text-teal-900',
        secondary: 'border-transparent bg-slate-100 text-slate-900',
        outline: 'border-slate-300 text-slate-900',
        destructive: 'border-transparent bg-red-100 text-red-900',
        warning: 'border-transparent bg-amber-100 text-amber-900',
        success: 'border-transparent bg-green-100 text-green-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
