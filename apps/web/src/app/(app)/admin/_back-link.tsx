'use client'

import { cn } from '@beaconhs/ui'
import { SmartBackLink } from '@/components/smart-back-link'

// Subtle "back to the admin hub" link for admin-menu pages whose header doesn't
// use DetailHeader's `back` prop. Resolves to wherever you actually came from
// (via the in-app history trail), falling back to the admin menu.
export function AdminBackLink({ className }: { className?: string }) {
  return (
    <div className={cn('mb-5', className)}>
      <SmartBackLink
        href="/admin"
        label="Back to admin"
        className="text-sm text-teal-700 hover:underline dark:text-teal-300"
      />
    </div>
  )
}
