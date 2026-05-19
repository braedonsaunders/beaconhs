// Kiosk page — shared-tablet sign-in/sign-out for jobsites.
// Sits OUTSIDE the (app) route group so the AppShell doesn't wrap it (no nav,
// no logged-in user, no tenant cookie). Authenticates by tenant slug in
// ?t=<slug> + a tenant-configured kiosk PIN.

import { sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { crews, orgUnits, people, tenants } from '@beaconhs/db/schema'
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
            Example:{' '}
            <code className="font-mono text-slate-300">/kiosk?t=acme-construction</code>
          </p>
        </div>
      </div>
    )
  }

  // Bypass RLS — the kiosk is unauthenticated; we trust the tenant slug
  // (which is enumerable but harmless) + the PIN check inside the action.
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const tenantRows = await tx.execute(
      sql`SELECT id, name, slug FROM tenants WHERE slug = ${slug} LIMIT 1`,
    )
    const tenant = (tenantRows as unknown as { id: string; name: string; slug: string }[])[0]
    if (!tenant) return null
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`)
    const [peopleRows, siteRows, crewRows] = await Promise.all([
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          jobTitle: people.jobTitle,
        })
        .from(people)
        .where(sql`${people.status} = 'active'`)
        .orderBy(people.lastName, people.firstName),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(sql`${orgUnits.level} = 'site'`)
        .orderBy(orgUnits.name),
      tx.select({ id: crews.id, name: crews.name }).from(crews).orderBy(crews.name),
    ])
    return { tenant, people: peopleRows, sites: siteRows, crews: crewRows }
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

  return (
    <KioskClient
      tenantId={data.tenant.id}
      tenantName={data.tenant.name}
      people={data.people}
      sites={data.sites}
      crews={data.crews}
    />
  )
}
