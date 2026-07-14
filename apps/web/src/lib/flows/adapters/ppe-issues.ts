import 'server-only'

// PPE ISSUE-REPORT FlowSubjectAdapter — subject = one ppe_issue_reports row (a
// damage / defect report against a PPE item), distinct from the 'ppe' subject
// (inspections). Exposes everything the bespoke issue-report PDF prints so a
// userland PDF document template reaches full parity. Field-map keys mirror
// MODULE_FLOW_PROFILES['ppe-issues'].

import { eq } from 'drizzle-orm'
import {
  people,
  ppeIssueReports,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, fmtDateTime, personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createPpeIssueReportFlowAdapter(
  ctx: RequestContext,
  issueReportId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'ppe-issues',
    subjectId: issueReportId,
    notifyCategory: 'ppe',
    auditEntityType: 'ppe_issue_report',
    // Issue reports live on the item's Issues tab; the item id isn't
    // resolvable synchronously here (same constraint as the 'ppe' subject).
    deepLink: () => '/ppe',
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: issueReportId,
        entityType: 'ppe_issue_report',
        heading: 'PPE issue report',
        reference: values.reference,
        subtitle: values.type_name,
        values,
      }),

    async loadValues() {
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: ppeIssueReports,
            item: ppeItems,
            typeName: ppeTypes.name,
            typeCategory: ppeTypes.category,
            holderFirst: people.firstName,
            holderLast: people.lastName,
            holderFormal: people.formalName,
            reportedByName: users.name,
          })
          .from(ppeIssueReports)
          .innerJoin(ppeItems, eq(ppeItems.id, ppeIssueReports.itemId))
          .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, ppeIssueReports.reportedByTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .where(eq(ppeIssueReports.id, issueReportId))
          .limit(1),
      )
      if (!head) return {}
      const r = head.r
      const item = head.item

      return {
        reference: item.serialNumber || `PPE-${issueReportId.slice(0, 8)}`,
        description: r.description ?? '',
        status: r.status ?? null,
        status_label: titleize(r.status),
        resolution: r.resolution ?? '',
        source: r.source,
        source_inspection_id: r.inspectionId ?? null,
        reported_at: fmtDateTime(r.reportedAt),
        resolved_at: fmtDateTime(r.resolvedAt),
        reported_by_name: r.reportedByNameSnapshot ?? head.reportedByName ?? '',
        // Linked PPE item (the bespoke PDF's PPE Item panel).
        type_name: head.typeName ?? '',
        type_category: head.typeCategory ?? '',
        item_serial: item.serialNumber ?? '',
        item_size: item.size ?? '',
        item_status: item.status ?? null,
        item_status_label: titleize(item.status),
        holder_name: personName({
          firstName: head.holderFirst,
          lastName: head.holderLast,
          formalName: head.holderFormal,
        }),
        purchase_date: fmtDate(item.purchaseDate),
        expires_on: fmtDate(item.expiresOn),
        // FK ids for conditions / recipient `field` targets.
        item_id: r.itemId ?? null,
        type_id: item.typeId ?? null,
        holder_person_id: item.currentHolderPersonId ?? null,
        reported_by_tenant_user_id: r.reportedByTenantUserId ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: ppeIssueReports.reportedByTenantUserId })
          .from(ppeIssueReports)
          .where(eq(ppeIssueReports.id, issueReportId))
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
