'use server'

// Create / update server actions for the locations detail page and its
// sub-entities. A location IS an org_unit with its own /locations/[id] detail
// page that doubles as the edit surface (LiveField autosave on the Overview
// tab). A project instant-creates and redirects to its own detail page. A
// customer contact has no detail page — it's a sub-record created and edited in
// a flyout on the parent location.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { customerContacts, orgUnits } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

// Address sub-fields live inside the org_units.address JSON column; they post
// as flat field names from the Overview LiveFields and are folded into the
// JSON object here.
const ADDRESS_FIELDS = {
  addressLine1: 'line1',
  addressLine2: 'line2',
  addressCity: 'city',
  addressRegion: 'region',
  addressPostal: 'postal',
  addressCountry: 'country',
} as const
type AddressFieldKey = keyof typeof ADDRESS_FIELDS

const TEXT_FIELDS = new Set(['name', 'code'])
const NUMBER_FIELDS = new Set(['lat', 'lng', 'geofenceMeters'])

/**
 * Inline field editor for the location Overview tab. Each Live* field posts
 * {id, field, value}; this validates the field against an allowlist, coerces it
 * for its column (text / number / address-JSON sub-key), persists, audits, and
 * revalidates. Stays on the page — no redirect.
 *
 * Allowlist:
 *   • text:    name, code
 *   • number:  lat, lng, geofenceMeters (blank → null)
 *   • address: addressLine1, addressLine2, addressCity, addressRegion,
 *              addressPostal, addressCountry (folded into the address JSON)
 *   • name is required (a blank name is rejected).
 */
export async function updateLocationField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const isAddress = field in ADDRESS_FIELDS
  const allowed = TEXT_FIELDS.has(field) || NUMBER_FIELDS.has(field) || isAddress
  if (!allowed) throw new Error('Field not allowed')

  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!before) throw new Error('Location not found')

  const trimmed = value.trim()
  let patch: Partial<typeof orgUnits.$inferInsert>

  if (NUMBER_FIELDS.has(field)) {
    const num = trimmed === '' ? null : Number(trimmed)
    if (num != null && Number.isNaN(num)) throw new Error('Invalid number')
    patch = { [field]: num }
  } else if (isAddress) {
    const key = ADDRESS_FIELDS[field as AddressFieldKey]
    const next = { ...(before.address ?? {}) }
    if (trimmed === '') delete next[key]
    else next[key] = trimmed
    patch = { address: Object.keys(next).length > 0 ? next : null }
  } else {
    // Text fields.
    if (field === 'name' && trimmed === '') throw new Error('Name is required')
    patch = { [field]: field === 'name' ? trimmed : trimmed === '' ? null : trimmed }
  }

  await ctx.db((tx) => tx.update(orgUnits).set(patch).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/locations/${id}`)
  revalidatePath('/locations')
}

/**
 * Instant-create a project under a customer and land in its detail page (the
 * single view+edit surface). Called from the location detail "Add project"
 * button; a blank name defaults to a placeholder the user renames there.
 * `parentId` is the parent location (customer) id.
 */
export async function createProject(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
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
 * Archive a customer location (soft-delete). Archived customers drop off the
 * default /locations list — switch the Status filter to "Archived" to find and
 * restore them. Non-cascading: descendant projects/sites are left untouched.
 */
export async function archiveLocation(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!before || before.deletedAt) return

  await ctx.db((tx) =>
    tx.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'archive',
    summary: `Archived ${before.level} "${before.name}"`,
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath('/locations')
  revalidatePath(`/locations/${id}`)
}

/**
 * Restore a previously archived customer location — it reappears in the default
 * /locations list.
 */
export async function restoreLocation(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!before || !before.deletedAt) return

  await ctx.db((tx) => tx.update(orgUnits).set({ deletedAt: null }).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'update',
    summary: `Restored ${before.level} "${before.name}"`,
    after: { deletedAt: null },
  })
  revalidatePath('/locations')
  revalidatePath(`/locations/${id}`)
}

/**
 * Quick-create a customer contact at a location from the detail flyout.
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
  assertCan(ctx, 'admin.org.manage')
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

/**
 * Update an existing customer contact from the detail flyout. `contactId` and
 * `orgUnitId` come from the row being edited.
 */
export async function updateContactFromDrawer(input: {
  contactId: string
  orgUnitId: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const contactId = input.contactId.trim()
  const orgUnitId = input.orgUnitId.trim()
  const name = input.name.trim()
  if (!contactId) return { ok: false, error: 'Contact is required.' }
  if (!name) return { ok: false, error: 'Name is required.' }

  const before = await ctx.db(async (tx) => {
    const [c] = await tx
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.id, contactId))
      .limit(1)
    return c
  })
  if (!before) return { ok: false, error: 'Contact not found.' }

  const patch = {
    name,
    role: input.role?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
    isPrimary: input.isPrimary,
  }
  await ctx.db((tx) =>
    tx.update(customerContacts).set(patch).where(eq(customerContacts.id, contactId)),
  )
  await recordAudit(ctx, {
    entityType: 'customer_contact',
    entityId: contactId,
    action: 'update',
    summary: `Updated contact "${name}"`,
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/locations/${orgUnitId}`)
  return { ok: true }
}

/**
 * Delete a customer contact. `orgUnitId` is the parent location id used to
 * revalidate its detail page.
 */
export async function deleteContact(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const id = String(formData.get('id') ?? '')
  const orgUnitId = String(formData.get('orgUnitId') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [c] = await tx.select().from(customerContacts).where(eq(customerContacts.id, id)).limit(1)
    return c
  })
  await ctx.db((tx) => tx.delete(customerContacts).where(eq(customerContacts.id, id)))
  await recordAudit(ctx, {
    entityType: 'customer_contact',
    entityId: id,
    action: 'delete',
    summary: before ? `Removed contact "${before.name}"` : 'Removed contact',
    before: before as unknown as Record<string, unknown>,
  })
  if (orgUnitId) revalidatePath(`/locations/${orgUnitId}`)
}
