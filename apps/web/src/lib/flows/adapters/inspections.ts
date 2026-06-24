import 'server-only'

// Inspections FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES.inspections.

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  inspectionRecordAttachments,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, titleize } from '../format'
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
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: recordId,
        entityType: 'inspection_record',
        heading: 'Inspection record',
        reference: values.reference,
        subtitle: values.type_id,
        values,
      }),

    async loadValues() {
      const inspTU = alias(tenantUsers, 'insp_inspector_tu')
      const inspU = alias(users, 'insp_inspector_u')
      const supTU = alias(tenantUsers, 'insp_supervisor_tu')
      const supU = alias(users, 'insp_supervisor_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: inspectionRecords,
            typeName: inspectionTypes.name,
            siteName: orgUnits.name,
            inspectorName: inspU.name,
            supervisorName: supU.name,
          })
          .from(inspectionRecords)
          .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
          .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
          .leftJoin(inspTU, eq(inspTU.id, inspectionRecords.inspectorTenantUserId))
          .leftJoin(inspU, eq(inspU.id, inspTU.userId))
          .leftJoin(supTU, eq(supTU.id, inspectionRecords.supervisorTenantUserId))
          .leftJoin(supU, eq(supU.id, supTU.userId))
          .where(eq(inspectionRecords.id, recordId))
          .limit(1),
      )
      if (!head) return {}
      const r = head.r

      const [criteria, photos] = await Promise.all([
        ctx.db((tx) =>
          tx
            .select({
              groupLabel: inspectionRecordCriteria.groupLabelSnapshot,
              question: inspectionRecordCriteria.questionTextSnapshot,
              answer: inspectionRecordCriteria.answer,
              severity: inspectionRecordCriteria.severity,
              nonCompliance: inspectionRecordCriteria.nonComplianceDescription,
              actionTaken: inspectionRecordCriteria.actionTaken,
            })
            .from(inspectionRecordCriteria)
            .where(eq(inspectionRecordCriteria.recordId, recordId))
            .orderBy(asc(inspectionRecordCriteria.sequence)),
        ),
        ctx.db((tx) =>
          tx
            .select({ caption: inspectionRecordAttachments.caption, r2Key: attachments.r2Key })
            .from(inspectionRecordAttachments)
            .innerJoin(attachments, eq(attachments.id, inspectionRecordAttachments.attachmentId))
            .where(eq(inspectionRecordAttachments.recordId, recordId)),
        ),
      ])

      return {
        status: r.status ?? null,
        status_label: titleize(r.status),
        reference: r.reference ?? null,
        type_name: head.typeName ?? '',
        occurred_at: fmtDateTime(r.occurredAt),
        site_name: head.siteName ?? '',
        inspector_name: head.inspectorName ?? '',
        supervisor_name: head.supervisorName ?? '',
        notes: r.notes ?? '',
        // FK ids for conditions / recipient `field` targets.
        type_id: r.typeId ?? null,
        site_org_unit_id: r.siteOrgUnitId ?? null,
        inspector_tenant_user_id: r.inspectorTenantUserId ?? null,
        // Collections.
        criteria: criteria.map((c) => ({
          group: c.groupLabel ?? '',
          question: c.question ?? '',
          answer: titleize(c.answer),
          severity: titleize(c.severity),
          non_compliance: c.nonCompliance ?? '',
          action_taken: c.actionTaken ?? '',
        })),
        photos: photos.map((p) => ({ url: publicUrl(p.r2Key), caption: p.caption ?? '' })),
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
