// Public Equipment Station kiosk — mounted-tablet check in/out with a USB scan
// gun. Lives OUTSIDE the (app) route group (no AppShell, no login). Authenticated
// by tenant slug in ?t=<slug> + the tenant's equipment-station PIN (verified
// server-side on every action). Mirrors the people sign-in/out kiosk at /kiosk.

import { sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { EquipmentKioskClient } from './kiosk-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipment kiosk · check in/out' }

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-2xl bg-slate-900 p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 text-sm text-slate-400">{children}</div>
      </div>
    </div>
  )
}

export default async function EquipmentKioskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const slug = typeof sp.t === 'string' ? sp.t : Array.isArray(sp.t) ? sp.t[0] : undefined

  if (!slug) {
    return (
      <Notice title="Kiosk not configured">
        Open this URL with{' '}
        <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-amber-400">
          ?t=&lt;tenant-slug&gt;
        </code>
        .
      </Notice>
    )
  }

  const data = await db.transaction(async (tx) => {
    const tenantRows = await tx.execute(
      sql`SELECT id, name, slug FROM tenants WHERE slug = ${slug} LIMIT 1`,
    )
    const tenant = (tenantRows as unknown as { id: string; name: string; slug: string }[])[0]
    if (!tenant) return null
    return { tenant }
  })

  if (!data) {
    return (
      <Notice title="Tenant not found">
        No tenant matches slug{' '}
        <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-amber-400">{slug}</code>.
      </Notice>
    )
  }
  return <EquipmentKioskClient tenantId={data.tenant.id} tenantName={data.tenant.name} />
}
