'use server'

import { sql } from 'drizzle-orm'
import { auditLog, kioskScans } from '@beaconhs/db/schema'
import { db } from '@beaconhs/db'

export type RecordKioskScanInput = {
  tenantId: string
  personId: string
  kind: 'in' | 'out'
  siteOrgUnitId: string | null
  crewId: string | null
  deviceLabel: string | null
  pin: string
}

export async function recordKioskScan(
  input: RecordKioskScanInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.tenantId || !input.personId) return { ok: false, error: 'Missing required fields' }
  if (input.kind !== 'in' && input.kind !== 'out') return { ok: false, error: 'Bad kind' }
  if (!input.pin) return { ok: false, error: 'PIN required' }

  // Verify the PIN against the tenant. We bypass RLS here because the kiosk
  // page is unauthenticated (no user session); access is gated by tenant slug
  // + PIN check below.
  const tenant = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const rows = await tx.execute(
      sql`SELECT id, kiosk_pin FROM tenants WHERE id = ${input.tenantId} LIMIT 1`,
    )
    const row = (rows as unknown as { id: string; kiosk_pin: string | null }[])[0]
    return row ?? null
  })
  if (!tenant) return { ok: false, error: 'Tenant not found' }
  if (!tenant.kiosk_pin) return { ok: false, error: 'Kiosk PIN not configured for this tenant' }
  if (tenant.kiosk_pin !== input.pin) return { ok: false, error: 'Invalid PIN' }

  const scanId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`)
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`)
    const [row] = await tx
      .insert(kioskScans)
      .values({
        tenantId: input.tenantId,
        personId: input.personId,
        kind: input.kind,
        siteOrgUnitId: input.siteOrgUnitId,
        crewId: input.crewId,
        deviceLabel: input.deviceLabel,
      })
      .returning({ id: kioskScans.id })
    if (!row) throw new Error('Failed to insert kiosk scan')

    // Inline audit (we don't have a RequestContext on the kiosk path because
    // the device is unauthenticated). recordAudit expects a ctx, so write a
    // tenant-scoped row directly.
    await tx.insert(auditLog).values({
      tenantId: input.tenantId,
      actorUserId: null,
      entityType: 'kiosk_scan',
      entityId: row.id,
      action: 'create',
      summary: `Kiosk ${input.kind === 'in' ? 'sign-in' : 'sign-out'}`,
      after: {
        personId: input.personId,
        kind: input.kind,
        siteOrgUnitId: input.siteOrgUnitId,
        crewId: input.crewId,
        deviceLabel: input.deviceLabel,
      },
    })
    return row.id
  })
  return { ok: true, id: scanId }
}
