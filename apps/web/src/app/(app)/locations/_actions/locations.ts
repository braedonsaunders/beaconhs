'use server'

// Create server actions for the locations detail page sub-entities.
// A project is an org_unit with its own /locations/[id] detail page, so it
// instant-creates and redirects there (no create drawer). A customer contact
// has no detail page — it's a sub-record edited in place — so it keeps a
// create drawer (typed-object variant that just refreshes the location page).

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { customerContacts, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Instant-create a project under a customer and land in its detail page (the
 * single view+edit surface). Called from the location detail "New project"
 * button; a blank name defaults to a placeholder the user renames there.
 * `parentId` is the parent location (customer) id.
 */
export async function createProject(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const parentId = String(formData.get('parentId') ?? '').trim()
  if (!parentId) return
  const name = String(formData.get('name') ?? '').trim() || 'Untitled project'
  const code = String(formData.get('code') ?? '').trim() || null

  // Verify the parent exists & is owned by this tenant.
  const parent = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(orgUnits).where(eq(orgUnits.id, parentId)).limit(1)
    return p
  })
  if (!parent) return

  const [row] = await ctx.db((tx) =>
    tx
      .insert(orgUnits)
      .values({
        tenantId: ctx.tenantId,
        parentId,
        level: 'project',
        name,
        code,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added project "${name}" under ${parent.name}`,
      after: { name, code, level: 'project', parentId },
    })
  }
  revalidatePath('/locations')
  revalidatePath(`/locations/${parentId}`)
  if (row) redirect(`/locations/${row.id}`)
}

/**
 * Update a location's own details (name/code/address/geolocation) from the
 * inline editor on its detail page. Stays on the page — no redirect.
 */
export async function updateLocation(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!before) return

  const latRaw = String(formData.get('lat') ?? '').trim()
  const lngRaw = String(formData.get('lng') ?? '').trim()
  const geofenceRaw = String(formData.get('geofenceMeters') ?? '').trim()

  const patch = {
    name: String(formData.get('name') ?? '').trim() || before.name,
    code: String(formData.get('code') ?? '').trim() || null,
    lat: latRaw.length > 0 ? Number(latRaw) : null,
    lng: lngRaw.length > 0 ? Number(lngRaw) : null,
    geofenceMeters: geofenceRaw.length > 0 ? Number(geofenceRaw) : null,
    address: buildAddressFromForm(formData),
  }

  await ctx.db((tx) => tx.update(orgUnits).set(patch).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'update',
    summary: `Edited ${before.level} "${patch.name}"`,
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/locations/${id}`)
  revalidatePath('/locations')
}

function buildAddressFromForm(formData: FormData): {
  line1?: string
  line2?: string
  city?: string
  region?: string
  postal?: string
  country?: string
} | null {
  const fields = {
    line1: String(formData.get('addressLine1') ?? '').trim(),
    line2: String(formData.get('addressLine2') ?? '').trim(),
    city: String(formData.get('addressCity') ?? '').trim(),
    region: String(formData.get('addressRegion') ?? '').trim(),
    postal: String(formData.get('addressPostal') ?? '').trim(),
    country: String(formData.get('addressCountry') ?? '').trim(),
  }
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.length > 0))
  return Object.keys(cleaned).length > 0 ? cleaned : null
}

/**
 * Quick-create a customer contact at a location from the detail drawer.
 * `orgUnitId` is the parent location id.
 */
export async function createContactFromDrawer(input: {
  orgUnitId: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const orgUnitId = input.orgUnitId.trim()
  const name = input.name.trim()
  if (!orgUnitId) return { ok: false, error: 'Location is required.' }
  if (!name) return { ok: false, error: 'Name is required.' }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(customerContacts)
      .values({
        tenantId: ctx.tenantId,
        orgUnitId,
        name,
        role: input.role?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        notes: input.notes?.trim() || null,
        isPrimary: input.isPrimary,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'customer_contact',
      entityId: row.id,
      action: 'create',
      summary: `Added contact "${name}"`,
      after: {
        name,
        role: input.role,
        email: input.email,
        phone: input.phone,
        isPrimary: input.isPrimary,
        orgUnitId,
      },
    })
  }
  revalidatePath(`/locations/${orgUnitId}`)
  return { ok: true }
}
