import 'server-only'

// Hazard Assessments (HazID) FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES.hazid.

import { eq } from 'drizzle-orm'
import { hazidAssessments, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import type { FlowSubjectAdapter } from '../types'

export function createHazidFlowAdapter(
  ctx: RequestContext,
  assessmentId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'hazid',
    subjectId: assessmentId,
    notifyCategory: 'hazid',
    auditEntityType: 'hazid_assessment',
    deepLink: () => `/hazard-assessments/${assessmentId}`,
    pdfJob: () => ({ kind: 'hazid', tenantId: ctx.tenantId, assessmentId }),

    async loadValues() {
      const [a] = await ctx.db((tx) =>
        tx
          .select({
            reference: hazidAssessments.reference,
            jobScope: hazidAssessments.jobScope,
            locationOnSite: hazidAssessments.locationOnSite,
            locked: hazidAssessments.locked,
            inProgress: hazidAssessments.inProgress,
            occurredAt: hazidAssessments.occurredAt,
            siteOrgUnitId: hazidAssessments.siteOrgUnitId,
            projectOrgUnitId: hazidAssessments.projectOrgUnitId,
            supervisorPersonId: hazidAssessments.supervisorPersonId,
            assessmentTypeId: hazidAssessments.assessmentTypeId,
          })
          .from(hazidAssessments)
          .where(eq(hazidAssessments.id, assessmentId))
          .limit(1),
      )
      return {
        reference: a?.reference ?? null,
        job_scope: a?.jobScope ?? null,
        location_on_site: a?.locationOnSite ?? null,
        locked: a?.locked ?? null,
        in_progress: a?.inProgress ?? null,
        occurred_at: a?.occurredAt ? a.occurredAt.toISOString() : null,
        site_org_unit_id: a?.siteOrgUnitId ?? null,
        project_org_unit_id: a?.projectOrgUnitId ?? null,
        supervisor_person_id: a?.supervisorPersonId ?? null,
        assessment_type_id: a?.assessmentTypeId ?? null,
      }
    },

    async resolveSubmitter() {
      const [a] = await ctx.db((tx) =>
        tx
          .select({ tuid: hazidAssessments.reportedByTenantUserId })
          .from(hazidAssessments)
          .where(eq(hazidAssessments.id, assessmentId))
          .limit(1),
      )
      const tuid = a?.tuid ?? null
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
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: assessmentId,
        source: 'jsha',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
