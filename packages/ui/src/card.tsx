import * as React from 'react'
import { cn } from './utils'

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * When true, the card gets a subtle hover lift + shadow bump. Use for
   * cards that are wrapped in <Link> or have onClick.
   */
  interactive?: boolean
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, onClick, onKeyDown, ...props }, ref) => {
    // Auto-detect interactivity: explicit prop wins, but onClick implies it.
    const isInteractive = interactive ?? typeof onClick === 'function'
    // A card wired with its own onClick must behave like a button for keyboard
    // and assistive-tech users, not a mouse-only div.
    const clickable = isInteractive && typeof onClick === 'function'
    return (
      <div
        ref={ref}
        onClick={onClick}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={(e) => {
          if (clickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
          onKeyDown?.(e)
        }}
        className={cn(
          'rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
          isInteractive &&
            'cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:hover:border-slate-600',
          className,
        )}
        {...props}
      />
    )
  },
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-lg font-semibold text-slate-900 dark:text-slate-100', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-slate-500 dark:text-slate-400', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'
