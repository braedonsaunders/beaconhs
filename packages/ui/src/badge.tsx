import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'border-teal-200/70 bg-teal-50 text-teal-800',
        secondary: 'border-slate-200 bg-slate-100 text-slate-700',
        outline: 'border-slate-300 bg-white text-slate-700',
        destructive: 'border-red-200/80 bg-red-50 text-red-700',
        warning: 'border-amber-200/80 bg-amber-50 text-amber-800',
        success: 'border-green-200/80 bg-green-50 text-green-800',
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
