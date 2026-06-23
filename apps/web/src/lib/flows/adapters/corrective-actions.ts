import 'server-only'

// Corrective Actions FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES['corrective-actions']. No spawnCorrectiveAction — a CA
// spawning a CA is intentionally not offered.

import { eq } from 'drizzle-orm'
import { correctiveActions, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { FlowSubjectAdapter } from '../types'

export function createCorrectiveActionFlowAdapter(
  ctx: RequestContext,
  caId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'corrective-actions',
    subjectId: caId,
    notifyCategory: 'ca',
    auditEntityType: 'corrective_action',
    deepLink: () => `/corrective-actions/${caId}`,

    async loadValues() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({
            status: correctiveActions.status,
            reference: correctiveActions.reference,
            title: correctiveActions.title,
            severity: correctiveActions.severity,
            dueOn: correctiveActions.dueOn,
            siteOrgUnitId: correctiveActions.siteOrgUnitId,
            ownerTenantUserId: correctiveActions.ownerTenantUserId,
          })
          .from(correctiveActions)
          .where(eq(correctiveActions.id, caId))
          .limit(1),
      )
      return {
        status: r?.status ?? null,
        reference: r?.reference ?? null,
        title: r?.title ?? null,
        severity: r?.severity ?? null,
        due_on: r?.dueOn ?? null,
        site_org_unit_id: r?.siteOrgUnitId ?? null,
        owner_tenant_user_id: r?.ownerTenantUserId ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: correctiveActions.ownerTenantUserId })
          .from(correctiveActions)
          .where(eq(correctiveActions.id, caId))
          .limit(1),
      )
      const tuid = r?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
