// Kiosk page — shared-tablet sign-in/sign-out for jobsites.
// Sits OUTSIDE the (app) route group so the AppShell doesn't wrap it (no nav,
// no logged-in user, no tenant cookie). Authenticates by tenant slug in
// ?t=<slug> + a tenant-configured kiosk PIN.

import { sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { KioskClient } from './kiosk-client'

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
  const data = await db.transaction(async (tx) => {
    const tenantRows = await tx.execute(
      sql`
        SELECT id, name, slug, kiosk_pin IS NOT NULL AS kiosk_enabled
        FROM tenants
        WHERE slug = ${slug}
        LIMIT 1
      `,
    )
    const tenant = (
      tenantRows as unknown as {
        id: string
        name: string
        slug: string
        kiosk_enabled: boolean
      }[]
    )[0]
    if (!tenant) return null
    return { tenant, kioskEnabled: tenant.kiosk_enabled }
  })

  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">Tenant not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            No tenant matches slug{' '}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-amber-400">
              {slug}
            </code>
            .
          </p>
        </div>
      </div>
    )
  }
  if (!data.kioskEnabled) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-semibold">Kiosk disabled</h1>
          <p className="mt-2 text-sm text-slate-400">This tenant has not configured a kiosk PIN.</p>
        </div>
      </div>
    )
  }

  return <KioskClient tenantId={data.tenant.id} tenantName={data.tenant.name} />
}
