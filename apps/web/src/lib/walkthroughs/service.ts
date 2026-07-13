// Server-side walkthrough resolution: which tours this user may launch, and
// which (if any) should auto-start this session. Combines the code registry
// with the tenant's walkthrough_settings overrides, the user's role
// assignments, and their walkthrough_progress rows.

import { eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { walkthroughProgress, walkthroughSettings } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getEffectiveRoleIds } from '@/lib/effective-roles'
import { WALKTHROUGHS, type Walkthrough } from './registry'

type WalkthroughSettingRow = {
  walkthroughId: string
  enabled: boolean
  autoStart: boolean
  roleIds: string[]
}

type ResolvedWalkthrough = {
  walkthrough: Walkthrough
  enabled: boolean
  autoStart: boolean
  roleIds: string[]
  /** This user completed or dismissed it already. */
  done: boolean
}

/** Effective per-tour config: tenant row when present, registry defaults otherwise. */
export async function loadWalkthroughSettings(tx: Database): Promise<WalkthroughSettingRow[]> {
  const rows = await tx
    .select({
      walkthroughId: walkthroughSettings.walkthroughId,
      enabled: walkthroughSettings.enabled,
      autoStart: walkthroughSettings.autoStart,
      roleIds: walkthroughSettings.roleIds,
    })
    .from(walkthroughSettings)
  const byId = new Map(rows.map((r) => [r.walkthroughId, r]))
  return WALKTHROUGHS.map((w) => {
    const row = byId.get(w.id)
    return {
      walkthroughId: w.id,
      enabled: row?.enabled ?? w.defaultEnabled,
      autoStart: row?.autoStart ?? w.defaultAutoStart,
      roleIds: row?.roleIds ?? [],
    }
  })
}

/**
 * Tours this user may see (enabled + role match), each flagged with completion,
 * plus the single tour to auto-start now (first enabled auto-start tour the
 * user has not finished or dismissed). Auto-start is suppressed while
 * impersonating — an admin viewing as someone should never consume that
 * person's first-run tour.
 */
export async function resolveWalkthroughs(
  ctx: RequestContext,
  tx: Database,
): Promise<{ visible: ResolvedWalkthrough[]; autoStartId: string | null }> {
  const [settings, progressRows, myRoles] = await Promise.all([
    loadWalkthroughSettings(tx),
    tx
      .select({ walkthroughId: walkthroughProgress.walkthroughId })
      .from(walkthroughProgress)
      .where(eq(walkthroughProgress.userId, ctx.userId)),
    getEffectiveRoleIds(ctx, tx),
  ])
  const done = new Set(progressRows.map((r) => r.walkthroughId))
  const settingById = new Map(settings.map((s) => [s.walkthroughId, s]))

  const visible: ResolvedWalkthrough[] = []
  for (const walkthrough of WALKTHROUGHS) {
    const s = settingById.get(walkthrough.id)!
    if (!s.enabled) continue
    // Empty roleIds = every role. Super-admins (no membership/roles) see all
    // tours so they can review them, but role-restricted tours never auto-start
    // for them.
    const roleMatch =
      s.roleIds.length === 0 || ctx.isSuperAdmin || s.roleIds.some((id) => myRoles.has(id))
    if (!roleMatch) continue
    visible.push({
      walkthrough,
      enabled: s.enabled,
      autoStart: s.autoStart,
      roleIds: s.roleIds,
      done: done.has(walkthrough.id),
    })
  }

  // Super-admins reviewing a tenant shouldn't be pulled into first-run tours.
  const autoStart =
    ctx.impersonation || ctx.isSuperAdmin
      ? null
      : (visible.find((v) => v.autoStart && !v.done) ?? null)
  const autoStartId = autoStart?.walkthrough.id ?? null

  return { visible, autoStartId }
}
