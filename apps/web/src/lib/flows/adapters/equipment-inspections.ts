import 'server-only'

// Equipment inspection FlowSubjectAdapter — subject = one
// equipment_inspection_records row (the legacy "Equipment Inspection —
// [EquipmentName] (date)" email fires on submit). Field-map keys mirror
// MODULE_FLOW_PROFILES['equipment-inspections'].

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  equipmentInspectionRecordAttachments,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, fmtDateTime, personName, titleize, yesNo } from '../format'
import type { FlowSubjectAdapter } from '../types'

function answerLabel(a: string | null): string {
  if (!a) return ''
  return a === 'n_a' ? 'N/A' : titleize(a)
}

export function createEquipmentInspectionFlowAdapter(
  ctx: RequestContext,
  recordId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'equipment-inspections',
    subjectId: recordId,
    notifyCategory: 'equipment',
    auditEntityType: 'equipment_inspection_record',
    deepLink: () => `/equipment/inspections/${recordId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: recordId,
        entityType: 'equipment_inspection_record',
        heading: 'Equipment inspection',
        reference: values.reference,
        subtitle: values.equipment_name,
        values,
      }),

    async loadValues() {
      const inspTU = alias(tenantUsers, 'eqi_inspector_tu')
      const inspU = alias(users, 'eqi_inspector_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: equipmentInspectionRecords,
            typeName: equipmentInspectionTypes.name,
            equipmentName: equipmentItems.name,
            assetTag: equipmentItems.assetTag,
            siteName: orgUnits.name,
            inspectorUserName: inspU.name,
            inspectorPersonFirst: people.firstName,
            inspectorPersonLast: people.lastName,
            inspectorPersonFormal: people.formalName,
          })
          .from(equipmentInspectionRecords)
          .leftJoin(
            equipmentInspectionTypes,
            eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
          )
          .leftJoin(
            equipmentItems,
            eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId),
          )
          .leftJoin(orgUnits, eq(orgUnits.id, equipmentInspectionRecords.siteOrgUnitId))
          .leftJoin(inspTU, eq(inspTU.id, equipmentInspectionRecords.inspectorTenantUserId))
          .leftJoin(inspU, eq(inspU.id, inspTU.userId))
          .leftJoin(people, eq(people.id, equipmentInspectionRecords.inspectorPersonId))
          .where(eq(equipmentInspectionRecords.id, recordId))
          .limit(1),
      )
      if (!head) return {}
      const r = head.r

      const [criteria, photos] = await Promise.all([
        ctx.db((tx) =>
          tx
            .select({
              groupLabel: equipmentInspectionRecordCriteria.groupLabelSnapshot,
              question: equipmentInspectionRecordCriteria.questionTextSnapshot,
              answer: equipmentInspectionRecordCriteria.answer,
              numericValue: equipmentInspectionRecordCriteria.numericValue,
              textValue: equipmentInspectionRecordCriteria.textValue,
              severity: equipmentInspectionRecordCriteria.severity,
              comment: equipmentInspectionRecordCriteria.comment,
              actionTaken: equipmentInspectionRecordCriteria.actionTaken,
            })
            .from(equipmentInspectionRecordCriteria)
            .where(eq(equipmentInspectionRecordCriteria.recordId, recordId))
            .orderBy(asc(equipmentInspectionRecordCriteria.sequence)),
        ),
        ctx.db((tx) =>
          tx
            .select({
              caption: equipmentInspectionRecordAttachments.caption,
              r2Key: attachments.r2Key,
            })
            .from(equipmentInspectionRecordAttachments)
            .innerJoin(
              attachments,
              eq(attachments.id, equipmentInspectionRecordAttachments.attachmentId),
            )
            .where(eq(equipmentInspectionRecordAttachments.recordId, recordId)),
        ),
      ])

      const inspectorName =
        head.inspectorUserName ||
        personName({
          firstName: head.inspectorPersonFirst,
          lastName: head.inspectorPersonLast,
          formalName: head.inspectorPersonFormal,
        }) ||
        r.inspectorText ||
        ''

      return {
        reference: r.reference ?? null,
        status: r.status ?? null,
        status_label: titleize(r.status),
        result: r.result ?? null,
        result_label: titleize(r.result),
        type_name: head.typeName ?? '',
        equipment_name: head.equipmentName ?? '',
        asset_tag: head.assetTag ?? '',
        serial: r.serial ?? '',
        interval_label: r.intervalLabel ?? '',
        occurred_at: fmtDateTime(r.occurredAt),
        next_due_on: fmtDate(r.nextDueOn),
        hours: r.hours ?? '',
        is_rental: yesNo(r.isRental),
        site_name: head.siteName ?? '',
        inspector_name: inspectorName,
        notes: r.notes ?? '',
        // FK ids for conditions / recipient `field` targets.
        equipment_item_id: r.equipmentItemId ?? null,
        inspection_type_id: r.inspectionTypeId ?? null,
        site_org_unit_id: r.siteOrgUnitId ?? null,
        inspector_tenant_user_id: r.inspectorTenantUserId ?? null,
        inspector_person_id: r.inspectorPersonId ?? null,
        // Collections.
        criteria: criteria.map((c) => ({
          group: c.groupLabel ?? '',
          question: c.question ?? '',
          answer: answerLabel(c.answer) || (c.textValue ?? '') || (c.numericValue ?? ''),
          severity: titleize(c.severity),
          comment: c.comment ?? '',
          action_taken: c.actionTaken ?? '',
        })),
        photos: photos.map((p) => ({ url: publicUrl(p.r2Key), caption: p.caption ?? '' })),
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({
            submittedBy: equipmentInspectionRecords.submittedByTenantUserId,
            inspector: equipmentInspectionRecords.inspectorTenantUserId,
          })
          .from(equipmentInspectionRecords)
          .where(eq(equipmentInspectionRecords.id, recordId))
          .limit(1),
      )
      const tuid = r?.submittedBy ?? r?.inspector ?? null
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
        sourceEntityType: 'equipment_inspection_record',
        sourceEntityId: recordId,
        source: 'inspection',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
