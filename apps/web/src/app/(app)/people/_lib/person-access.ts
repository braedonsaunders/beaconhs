// Shared authorization helpers for per-person mutations that are legitimately
// available to two audiences: people-module managers (assertCanManageModule)
// and the person themself (their linked user account). Files, the saved
// signature, and job-description acknowledgements all use this manage-or-self
// rule; everything else in the module stays manage-only.

import { canManageModule } from '@/lib/module-admin/guard'
import type { requireRequestContext } from '@/lib/auth'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

/** True when the given person record is the caller's own linked record. */
export function isOwnPersonRecord(ctx: Ctx, personId: string): boolean {
  return ctx.personId != null && ctx.personId === personId
}

/**
 * Throw unless the caller manages the people module OR the target person is
 * their own linked record. Use at the top of manage-or-self server actions.
 */
export function assertCanActOnPerson(ctx: Ctx, personId: string): void {
  if (canManageModule(ctx, 'people')) return
  if (isOwnPersonRecord(ctx, personId)) return
  throw new Error('Forbidden: admin.org.manage permission required')
}
