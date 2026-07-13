// Kiosk page — shared-tablet sign-in/sign-out for jobsites.
// Sits OUTSIDE the (app) route group so the AppShell doesn't wrap it (no nav,
// no logged-in user, no tenant cookie). Authenticates by tenant slug in
// ?t=<slug> + a tenant-configured kiosk PIN.

import { db, type Database } from '@beaconhs/db'
import { KioskClient } from './kiosk-client'
import { resolveActiveTenant } from '@/lib/active-tenant'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Kiosk · sign in/out' }

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const slug = typeof sp.t === 'string' ? sp.t : Array.isArray(sp.t) ? sp.t[0] : undefined

  if (!slug) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">Kiosk not configured</h1>
          <p className="mt-2 text-sm text-slate-400">
            Open this URL with{' '}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-teal-400">
              ?t=&lt;tenant-slug&gt;
            </code>
            .
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Example: <code className="font-mono text-slate-300">/kiosk?t=acme-construction</code>
          </p>
        </div>
      </div>
    )
  }

  // The kiosk is unauthenticated. Resolve only non-sensitive tenant chrome here;
  // roster/site/crew data is loaded by a PIN-verified server action.
  const tenant = await db.transaction((tx) =>
    resolveActiveTenant(tx as unknown as Database, { slug }),
  )

  if (!tenant) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">Kiosk unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">
            This workspace is unavailable. Ask your administrator to check its status.
          </p>
        </div>
      </div>
    )
  }
  if (!tenant.kioskPin) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">Kiosk disabled</h1>
          <p className="mt-2 text-sm text-slate-400">This tenant has not configured a kiosk PIN.</p>
        </div>
      </div>
    )
  }

  return <KioskClient tenantId={tenant.id} tenantName={tenant.name} />
}
