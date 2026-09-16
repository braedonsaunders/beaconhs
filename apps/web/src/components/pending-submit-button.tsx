'use client'

import { type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary'

/**
 * Submit button that shows a spinner while its form's server action runs.
 *
 * For actions with no immediate visual result — rendering a document book PDF
 * takes several seconds and then navigates — a button that stays idle reads as
 * "nothing happened", and people click it again. `useFormStatus` only reports
 * the status of the form this button is inside, so it must be a child of that
 * form rather than the component rendering it.
 */
export function PendingSubmitButton({
  children,
  pendingLabel,
  icon,
  variant = 'outline',
  disabled = false,
  title,
}: {
  children: ReactNode
  /** Replaces the label while running. Omit to keep the label beside a spinner. */
  pendingLabel?: ReactNode
  icon?: ReactNode
  variant?: Variant
  disabled?: boolean
  title?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled} title={title}>
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {pendingLabel ?? children}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </Button>
  )
}
