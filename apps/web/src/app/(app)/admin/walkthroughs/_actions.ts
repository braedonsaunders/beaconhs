'use server'

// Admin config for guided tours: per-walkthrough enable / auto-start / role
// scoping. One upsert per walkthrough row (unique on tenant + walkthrough id).

import { revalidatePath } from 'next/cache'
import { inArray, sql } from 'drizzle-orm'
import { roles, walkthroughSettings } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { loadWalkthroughSettings } from '@/lib/walkthroughs/service'
import { walkthroughById } from '@/lib/walkthroughs/registry'

export async function saveWalkthroughSetting(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.settings.manage')

  const walkthroughId = String(formData.get('walkthroughId') ?? '')
  const walkthrough = walkthroughById(walkthroughId)
  if (!walkthrough) throw new Error('Unknown walkthrough')

  const enabled = formData.get('enabled') === 'on'
  const autoStart = formData.get('autoStart') === 'on'
  const requestedRoleIds = formData.getAll('roleIds').map(String).filter(Boolean)

  await ctx.db(async (tx) => {
    // Only accept role ids that exist in this tenant.
    const roleIds =
      requestedRoleIds.length > 0
        ? (
            await tx
              .select({ id: roles.id })
              .from(roles)
              .where(inArray(roles.id, requestedRoleIds))
          ).map((r) => r.id)
        : []

    const [before] = (await loadWalkthroughSettings(tx)).filter(
      (s) => s.walkthroughId === walkthroughId,
    )

    await tx
      .insert(walkthroughSettings)
      .values({ tenantId: ctx.tenantId, walkthroughId, enabled, autoStart, roleIds })
      .onConflictDoUpdate({
        target: [walkthroughSettings.tenantId, walkthroughSettings.walkthroughId],
        set: { enabled, autoStart, roleIds, updatedAt: sql`now()` },
      })

    await recordAudit(ctx, {
      entityType: 'walkthrough_setting',
      entityId: walkthroughId,
      action: 'update',
      summary: `Walkthrough "${walkthrough.title}" settings updated`,
      before: before ? { ...before } : null,
      after: { walkthroughId, enabled, autoStart, roleIds },
    })
  })

  revalidatePath('/admin/walkthroughs')
  // Availability is resolved in the (app) layout — refresh it everywhere.
  revalidatePath('/', 'layout')
}
