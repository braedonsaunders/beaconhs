'use server'

// Per-user walkthrough progress. Self-scoped (a user only ever writes their own
// row) so no extra permission gate beyond being signed in. Config writes live
// in /admin/walkthroughs/_actions.ts.

import { sql } from 'drizzle-orm'
import { walkthroughProgress } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { walkthroughById } from './registry'

export async function recordWalkthroughProgress(
  walkthroughId: string,
  status: 'completed' | 'dismissed',
): Promise<void> {
  const ctx = await requireRequestContext()
  if (!walkthroughById(walkthroughId)) return
  if (status !== 'completed' && status !== 'dismissed') return
  // While impersonating, never write the target user's progress.
  if (ctx.impersonation) return
  await ctx.db(async (tx) => {
    await tx
      .insert(walkthroughProgress)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        walkthroughId,
        status,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          walkthroughProgress.tenantId,
          walkthroughProgress.userId,
          walkthroughProgress.walkthroughId,
        ],
        set: { status, completedAt: new Date(), updatedAt: sql`now()` },
      })
  })
}
