// Shared authorization helpers for per-person mutations that are legitimately
// available to two audiences: people-module managers (assertCanManageModule)
// and the person themself (their linked user account). Files, the saved
// signature, and job-description acknowledgements all use this manage-or-self
// rule; everything else in the module stays manage-only.

import { eq } from 'drizzle-orm'
import { people } from '@beaconhs/db/schema'
import { canManageModule } from '@/lib/module-admin/guard'
import type { requireRequestContext } from '@/lib/auth'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

/** True when the given person record is linked to the caller's user account. */
export async function isOwnPersonRecord(ctx: Ctx, personId: string): Promise<boolean> {
  if (!personId) return false
  return ctx.db(async (tx) => {
    const [p] = await tx
      .select({ userId: people.userId })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    return p?.userId != null && p.userId === ctx.userId
  })
}

/**
 * Throw unless the caller manages the people module OR the target person is
 * their own linked record. Use at the top of manage-or-self server actions.
 */
export async function assertCanActOnPerson(ctx: Ctx, personId: string): Promise<void> {
  if (canManageModule(ctx, 'people')) return
  if (await isOwnPersonRecord(ctx, personId)) return
  throw new Error('Forbidden: admin.org.manage permission required')
}
