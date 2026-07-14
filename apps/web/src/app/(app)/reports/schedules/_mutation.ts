import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import { tenantUsers } from '@beaconhs/db/schema'
import { computeNextRunAt } from '@beaconhs/reports'
import type { RequestContext } from '@beaconhs/tenant'
import { requireUuidInput } from '@/lib/mutation-input'
import { loadDefinitionById } from '../_definitions'
import { parseScheduleForm } from './_parse'

export async function prepareScheduleMutation(ctx: RequestContext, formData: FormData) {
  if (!ctx.tenantId) throw new Error('An active tenant is required to schedule reports')

  const definitionId = requireUuidInput(formData.get('definitionId'), 'Report definition')
  const parsed = parseScheduleForm(formData)

  const definition = await loadDefinitionById(ctx.tenantId, definitionId)
  if (!definition) throw new Error('Unknown report definition')

  if (parsed.recipientUserIds.length) {
    const activeRecipients = await ctx.db((tx) =>
      tx
        .select({ userId: tenantUsers.userId })
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.status, 'active'),
            inArray(tenantUsers.userId, parsed.recipientUserIds),
          ),
        ),
    )
    const activeIds = new Set(activeRecipients.map((recipient) => recipient.userId))
    if (parsed.recipientUserIds.some((userId) => !activeIds.has(userId))) {
      throw new Error('One or more selected report recipients are no longer active members')
    }
  }

  return {
    definitionId,
    ...parsed,
    nextRunAt: computeNextRunAt(parsed),
  }
}
