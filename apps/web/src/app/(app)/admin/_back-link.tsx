import Link from 'next/link'
import { cn } from '@beaconhs/ui'

// Subtle "back to the admin hub" link for admin-menu pages whose header doesn't
// use DetailHeader's `back` prop. Matches the DetailHeader back style so every
// /admin/* destination has the same top-left return link to the admin menu.
export function AdminBackLink({ className }: { className?: string }) {
  return (
    <div className={cn('mb-5', className)}>
      <Link href="/admin" className="text-sm text-teal-700 hover:underline dark:text-teal-300">
        ← Back to admin
      </Link>
    </div>
  )
}
