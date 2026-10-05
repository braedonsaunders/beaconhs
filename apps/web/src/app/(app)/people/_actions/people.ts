'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { people } from '@beaconhs/db/schema'
import { materializeIdentityAudienceObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { getPersonSyncOrigin } from '@/lib/people-sync'
import { lockPersonGroupMembershipGraph } from '@/lib/person-group-memberships'

export async function deletePerson(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  if (!isUuid(id)) return { ok: false, error: 'Person not found.' }

  const result = await ctx.db(async (tx) => {
    // Match group writers' lock order before identity reconciliation locks the person.
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [before] = await tx
      .select()
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, id), isNull(people.deletedAt)))
      .limit(1)
      .for('update')
    if (!before) return { ok: false as const, error: 'Person not found.' }

    // The person lock also serializes natural-key adoption by the sync engine.
    // Manual-only and paused connections still own their linked records.
    if (await getPersonSyncOrigin(tx, id)) {
      return {
        ok: false as const,
        error: 'This person is managed by an external sync. Remove them in the source system.',
      }
    }

    const [after] = await tx
      .update(people)
      .set({ deletedAt: new Date() })
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, id), isNull(people.deletedAt)))
      .returning()
    if (!after) throw new Error('Person could not be deleted.')

    // Retain safety records, assignments and login membership. Only remove this
    // identity from current directory/picker/compliance audiences.
    await materializeIdentityAudienceObligations(tx, ctx.tenantId, [id])
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: id,
      action: 'delete',
      summary: `Deleted person ${before.firstName} ${before.lastName}`,
      before,
      after,
    })
    return { ok: true as const }
  })

  if (result.ok) {
    revalidatePath('/people', 'layout')
    revalidatePath('/compliance', 'layout')
  }
  return result
}
