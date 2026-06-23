import 'server-only'

// Inspections FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES.inspections.

import { eq } from 'drizzle-orm'
import { inspectionRecords, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import type { FlowSubjectAdapter } from '../types'

export function createInspectionFlowAdapter(
  ctx: RequestContext,
  recordId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'inspections',
    subjectId: recordId,
    notifyCategory: 'inspection',
    auditEntityType: 'inspection_record',
    deepLink: () => `/inspections/records/${recordId}`,

    async loadValues() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({
            status: inspectionRecords.status,
            reference: inspectionRecords.reference,
            typeId: inspectionRecords.typeId,
            occurredAt: inspectionRecords.occurredAt,
            siteOrgUnitId: inspectionRecords.siteOrgUnitId,
            inspectorTenantUserId: inspectionRecords.inspectorTenantUserId,
          })
          .from(inspectionRecords)
          .where(eq(inspectionRecords.id, recordId))
          .limit(1),
      )
      return {
        status: r?.status ?? null,
        reference: r?.reference ?? null,
        type_id: r?.typeId ?? null,
        occurred_at: r?.occurredAt ? r.occurredAt.toISOString() : null,
        site_org_unit_id: r?.siteOrgUnitId ?? null,
        inspector_tenant_user_id: r?.inspectorTenantUserId ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: inspectionRecords.inspectorTenantUserId })
          .from(inspectionRecords)
          .where(eq(inspectionRecords.id, recordId))
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

    spawnCorrectiveAction: (i) =>
      spawnCorrectiveActionForSubject(ctx, {
        sourceEntityType: 'inspection_record',
        sourceEntityId: recordId,
        source: 'inspection',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
