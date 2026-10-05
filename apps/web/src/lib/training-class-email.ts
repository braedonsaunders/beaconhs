import 'server-only'

import { and, eq } from 'drizzle-orm'
import { formAutomations } from '@beaconhs/db/schema'
import { planAutomation } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { createTrainingClassFlowAdapter } from './flows/adapters/training-classes'

export class ClassEmailError extends Error {}

/** Do not report an email as queued when no enabled email branch can run. */
export async function assertClassEmailConfigured(
  ctx: RequestContext,
  classId: string,
  event: 'class_confirmed' | 'class_reminder',
): Promise<void> {
  const flows = await ctx.db((tx) =>
    tx
      .select({ graph: formAutomations.graph })
      .from(formAutomations)
      .where(
        and(
          eq(formAutomations.subjectType, 'module'),
          eq(formAutomations.subjectKey, 'training-classes'),
          eq(formAutomations.enabled, true),
        ),
      ),
  )
  const values = await createTrainingClassFlowAdapter(ctx, classId).loadValues()
  if (
    !flows.some((flow) =>
      planAutomation(flow.graph, event, { values, rows: {}, entities: {} }).actions.some(
        (action) => action.action === 'send_email',
      ),
    )
  ) {
    throw new ClassEmailError(
      event === 'class_confirmed'
        ? 'Configure an enabled Email class flow in Training → Manage → Class automations before sending.'
        : 'Configure an enabled class reminder email flow in Training → Manage → Class automations before enabling reminders.',
    )
  }
}
