import 'server-only'

// PPE inspection FlowSubjectAdapter — subject = one ppe_inspections row (the
// legacy "PPE Inspection (date)" email fires when an inspection is recorded).
// Field-map keys mirror MODULE_FLOW_PROFILES.ppe.
//
// Note: the PPE model derives the overall result from the checklist answers at
// record time but does NOT persist per-criterion answers, so this subject has
// no `criteria` collection — the record carries the kind, result, and notes.

import { eq } from 'drizzle-orm'
import {
  people,
  ppeInspections,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, personName } from '../format'
import type { FlowSubjectAdapter } from '../types'

function kindLabel(kind: string | null): string {
  if (kind === 'pre_use') return 'Pre-use'
  if (kind === 'annual') return 'Annual'
  return ''
}

function resultLabel(result: string | null): string {
  if (result === 'pass') return 'Pass'
  if (result === 'fail') return 'Fail'
  if (result === 'n_a') return 'N/A'
  return ''
}

export function createPpeInspectionFlowAdapter(
  ctx: RequestContext,
  inspectionId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'ppe',
    subjectId: inspectionId,
    notifyCategory: 'ppe',
    auditEntityType: 'ppe_inspection',
    // There is no per-inspection page — inspections live on the item's
    // Inspections tab, and the item id isn't resolvable synchronously here.
    deepLink: () => '/ppe',
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: inspectionId,
        entityType: 'ppe_inspection',
        heading: 'PPE inspection',
        reference: values.reference,
        subtitle: values.type_name,
        values,
      }),

    async loadValues() {
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            i: ppeInspections,
            item: ppeItems,
            typeName: ppeTypes.name,
            typeCategory: ppeTypes.category,
            holderFirst: people.firstName,
            holderLast: people.lastName,
            holderFormal: people.formalName,
            inspectorName: users.name,
          })
          .from(ppeInspections)
          .innerJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
          .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, ppeInspections.inspectedByTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .where(eq(ppeInspections.id, inspectionId))
          .limit(1),
      )
      if (!head) return {}
      const i = head.i
      const item = head.item

      return {
        reference: item.serialNumber || `PPE-${inspectionId.slice(0, 8)}`,
        kind: i.kind ?? null,
        kind_label: kindLabel(i.kind),
        result: i.result ?? null,
        result_label: resultLabel(i.result),
        inspected_on: fmtDate(i.inspectedOn),
        next_due_on: fmtDate(i.nextDueOn),
        notes: i.notes ?? '',
        type_name: head.typeName ?? '',
        type_category: head.typeCategory ?? '',
        item_serial: item.serialNumber ?? '',
        item_size: item.size ?? '',
        holder_name: personName({
          firstName: head.holderFirst,
          lastName: head.holderLast,
          formalName: head.holderFormal,
        }),
        inspector_name: head.inspectorName ?? '',
        // FK ids for conditions / recipient `field` targets.
        item_id: i.itemId ?? null,
        type_id: item.typeId ?? null,
        holder_person_id: item.currentHolderPersonId ?? null,
        inspected_by_tenant_user_id: i.inspectedByTenantUserId ?? null,
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: ppeInspections.inspectedByTenantUserId })
          .from(ppeInspections)
          .where(eq(ppeInspections.id, inspectionId))
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
        sourceEntityType: 'ppe_inspection',
        sourceEntityId: inspectionId,
        source: 'inspection',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
