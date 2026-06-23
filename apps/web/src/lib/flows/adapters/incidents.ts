import 'server-only'

// Incidents FlowSubjectAdapter. Field-map keys mirror MODULE_FLOW_PROFILES.incidents.

import { eq } from 'drizzle-orm'
import { incidents, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import type { FlowSubjectAdapter } from '../types'

export function createIncidentFlowAdapter(
  ctx: RequestContext,
  incidentId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'incidents',
    subjectId: incidentId,
    notifyCategory: 'incident',
    auditEntityType: 'incident',
    deepLink: () => `/incidents/${incidentId}`,

    async loadValues() {
      const [i] = await ctx.db((tx) =>
        tx
          .select({
            status: incidents.status,
            reference: incidents.reference,
            title: incidents.title,
            type: incidents.type,
            severity: incidents.severity,
            occurredAt: incidents.occurredAt,
            siteOrgUnitId: incidents.siteOrgUnitId,
            departmentId: incidents.departmentId,
            supervisorPersonId: incidents.supervisorPersonId,
          })
          .from(incidents)
          .where(eq(incidents.id, incidentId))
          .limit(1),
      )
      return {
        status: i?.status ?? null,
        reference: i?.reference ?? null,
        title: i?.title ?? null,
        type: i?.type ?? null,
        severity: i?.severity ?? null,
        occurred_at: i?.occurredAt ? i.occurredAt.toISOString() : null,
        site_org_unit_id: i?.siteOrgUnitId ?? null,
        department_id: i?.departmentId ?? null,
        supervisor_person_id: i?.supervisorPersonId ?? null,
      }
    },

    async resolveSubmitter() {
      const [i] = await ctx.db((tx) =>
        tx
          .select({ tuid: incidents.reportedByTenantUserId })
          .from(incidents)
          .where(eq(incidents.id, incidentId))
          .limit(1),
      )
      const tuid = i?.tuid ?? null
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

    spawnCorrectiveAction: (i) =>
      spawnCorrectiveActionForSubject(ctx, {
        sourceEntityType: 'incident',
        sourceEntityId: incidentId,
        source: 'incident',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
