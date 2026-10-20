import { and, eq, isNull } from 'drizzle-orm'
import { complianceObligations, people } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import {
  evaluateComplianceHistory,
  loadAudience,
  resolveComplianceClock,
  resolveObligationAudience,
  supportsComplianceHistory,
} from '@beaconhs/compliance'
import type { requireRequestContext } from '@/lib/auth'

type Context = Awaited<ReturnType<typeof requireRequestContext>>

export async function loadComplianceHistory(
  ctx: Context,
  id: string,
  limit: number,
  selectedPerson?: string,
) {
  const canReadAll = can(ctx, 'compliance.read')
  return ctx.db(async (tx) => {
    const personId = canReadAll
      ? selectedPerson
      : (
          await tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.tenantId, ctx.tenantId),
                eq(people.userId, ctx.userId),
                isNull(people.deletedAt),
              ),
            )
            .limit(1)
        )[0]?.id
    if (!canReadAll && !personId) return null
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(
        and(eq(complianceObligations.tenantId, ctx.tenantId), eq(complianceObligations.id, id)),
      )
      .limit(1)
    if (!ob) return null
    const supported = supportsComplianceHistory(ob)
    const members = await resolveObligationAudience(
      tx,
      ctx.tenantId,
      await loadAudience(tx, ctx.tenantId, id),
    )
    const history = await evaluateComplianceHistory(
      tx,
      ctx.tenantId,
      ob,
      members,
      await resolveComplianceClock(tx, ctx.tenantId),
      limit,
    )
    if (
      !canReadAll &&
      !members.some((member) => member.personId === personId) &&
      !history.some((row) => row.personId === personId)
    )
      return null
    return {
      ob,
      supported: supported || history.length > 0,
      canReadAll,
      personId,
      history: personId ? history.filter((row) => row.personId === personId) : history,
    }
  })
}
