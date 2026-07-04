'use server'

// Server actions for the /locations/units admin — flat CRUD over org_units
// (customer / project / site / area), the same hierarchy the Locations records
// live in. Create runs through addOrgUnit (returns {ok|error} for the flyout);
// archive is a soft-delete row action. Editing a unit's name/address happens on
// its own /locations/[id] page.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isOrgUnitSynced } from '@/lib/org-sync'

type SaveResult = { ok: true } | { ok: false; error: string }

const LEVELS = ['customer', 'project', 'site', 'area'] as const
const BASE = '/locations/units'

async function requireOrgAdmin() {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.org.manage')) redirect('/locations')
  return ctx
}

export async function addOrgUnit(input: {
  name: string
  level: string
  parentId: string | null
}): Promise<SaveResult> {
  const ctx = await requireOrgAdmin()
  const name = input.name.trim()
  const level = input.level as (typeof LEVELS)[number]
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!LEVELS.includes(level)) return { ok: false, error: 'Choose a level.' }
  const parentId = input.parentId?.trim() || null
  const [row] = await ctx.db((tx) =>
    tx.insert(orgUnits).values({ tenantId: ctx.tenantId, name, level, parentId }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added ${level} "${name}"`,
    })
  }
  revalidatePath(BASE)
  revalidatePath('/locations')
  return { ok: true }
}

// Archive (soft delete) — org units are shared with the Locations records, which
// restore archived units from a location page. Non-cascading: descendants are
// left untouched and stay visible in the list. Units owned by an active
// data-sync connection cannot be archived here — the source system owns them, so
// the change would just be re-created on the next run.
export async function deleteOrgUnit(formData: FormData): Promise<void> {
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { before, synced } = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return { before: u ?? null, synced: u ? await isOrgUnitSynced(tx, id) : false }
  })
  if (!before || before.deletedAt) return
  if (synced) {
    revalidatePath(BASE)
    redirect(
      `${BASE}?error=${encodeURIComponent(
        `"${before.name}" is synced from an external system and can't be archived here. Disable its data-sync connection first.`,
      )}`,
    )
  }
  await ctx.db((tx) => tx.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'archive',
    summary: `Archived ${before.level} "${before.name}"`,
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath(BASE)
  revalidatePath('/locations')
}
