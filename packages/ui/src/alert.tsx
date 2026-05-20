import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm shadow-sm',
  {
    variants: {
      variant: {
        default: 'bg-white text-slate-900 border-slate-200',
        destructive:
          'border-red-200 bg-gradient-to-br from-red-50 to-red-50/60 text-red-900',
        warning:
          'border-amber-200 bg-gradient-to-br from-amber-50 to-amber-50/60 text-amber-900',
        success:
          'border-green-200 bg-gradient-to-br from-green-50 to-green-50/60 text-green-900',
        info: 'border-sky-200 bg-gradient-to-br from-sky-50 to-sky-50/60 text-sky-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
))
Alert.displayName = 'Alert'

export const AlertTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h5
    className={cn('mb-1 font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
)

export const AlertDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <div className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)} {...props} />
)
