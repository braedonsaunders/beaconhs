import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const alertVariants = cva('relative w-full rounded-lg border p-4', {
  variants: {
    variant: {
      default: 'bg-white text-slate-900 border-slate-200',
      destructive: 'border-red-200 bg-red-50 text-red-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      success: 'border-green-200 bg-green-50 text-green-900',
      info: 'border-sky-200 bg-sky-50 text-sky-900',
    },
  },
  defaultVariants: { variant: 'default' },
})

export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
)
Alert.displayName = 'Alert'

export const AlertTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h5 className={cn('mb-1 font-semibold leading-none tracking-tight', className)} {...props} />
)

export const AlertDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
)
