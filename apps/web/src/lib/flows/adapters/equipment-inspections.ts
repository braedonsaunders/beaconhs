import 'server-only'

// Equipment inspection FlowSubjectAdapter — subject = one
// equipment_inspection_records row (the legacy "Equipment Inspection —
// [EquipmentName] (date)" email fires on submit). Field-map keys mirror
// MODULE_FLOW_PROFILES['equipment-inspections'].

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
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
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, fmtDateTime, personName, titleize, yesNo } from '../format'
import type { FlowSubjectAdapter } from '../types'
import { photoDocumentUrl } from '@/lib/photo-document-url'

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
      const loaded = await ctx.db(async (tx) => {
        const [head] = await tx
          .select({
            r: equipmentInspectionRecords,
            typeName: equipmentInspectionTypes.name,
            equipmentName: equipmentItems.name,
            assetTag: equipmentItems.assetTag,
            equipmentMetadata: equipmentItems.metadata,
            siteName: orgUnits.name,
            inspectorUserName: inspU.name,
            inspectorPersonFirst: people.firstName,
            inspectorPersonLast: people.lastName,
            inspectorPersonFormal: people.formalName,
          })
          .from(equipmentInspectionRecords)
          .leftJoin(
            equipmentInspectionTypes,
            and(
              eq(equipmentInspectionTypes.tenantId, equipmentInspectionRecords.tenantId),
              eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
            ),
          )
          .leftJoin(
            equipmentItems,
            and(
              eq(equipmentItems.tenantId, equipmentInspectionRecords.tenantId),
              eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId),
            ),
          )
          .leftJoin(
            orgUnits,
            and(
              eq(orgUnits.tenantId, equipmentInspectionRecords.tenantId),
              eq(orgUnits.id, equipmentInspectionRecords.siteOrgUnitId),
            ),
          )
          .leftJoin(
            inspTU,
            and(
              eq(inspTU.tenantId, equipmentInspectionRecords.tenantId),
              eq(inspTU.id, equipmentInspectionRecords.inspectorTenantUserId),
            ),
          )
          .leftJoin(inspU, eq(inspU.id, inspTU.userId))
          .leftJoin(
            people,
            and(
              eq(people.tenantId, equipmentInspectionRecords.tenantId),
              eq(people.id, equipmentInspectionRecords.inspectorPersonId),
            ),
          )
          .where(
            and(
              eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
              eq(equipmentInspectionRecords.id, recordId),
              isNull(equipmentInspectionRecords.deletedAt),
            ),
          )
          .limit(1)
        if (!head) return null

        const criteria = await tx
          .select({
            groupLabel: equipmentInspectionRecordCriteria.groupLabelSnapshot,
            question: equipmentInspectionRecordCriteria.questionTextSnapshot,
            answer: equipmentInspectionRecordCriteria.answer,
            numericValue: equipmentInspectionRecordCriteria.numericValue,
            textValue: equipmentInspectionRecordCriteria.textValue,
            severity: equipmentInspectionRecordCriteria.severity,
            comment: equipmentInspectionRecordCriteria.comment,
            actionTaken: equipmentInspectionRecordCriteria.actionTaken,
            photoAttachmentIds: equipmentInspectionRecordCriteria.photoAttachmentIds,
          })
          .from(equipmentInspectionRecordCriteria)
          .where(
            and(
              eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
              eq(equipmentInspectionRecordCriteria.recordId, recordId),
            ),
          )
          .orderBy(asc(equipmentInspectionRecordCriteria.sequence))

        const recordPhotos = await tx
          .select({
            id: attachments.id,
            filename: attachments.filename,
            caption: equipmentInspectionRecordAttachments.caption,
            r2Key: attachments.r2Key,
            annotations: attachments.annotations,
            width: attachments.width,
            height: attachments.height,
          })
          .from(equipmentInspectionRecordAttachments)
          .innerJoin(
            attachments,
            and(
              eq(attachments.tenantId, equipmentInspectionRecordAttachments.tenantId),
              eq(attachments.id, equipmentInspectionRecordAttachments.attachmentId),
              eq(attachments.kind, 'image'),
            ),
          )
          .where(
            and(
              eq(equipmentInspectionRecordAttachments.tenantId, ctx.tenantId),
              eq(equipmentInspectionRecordAttachments.recordId, recordId),
            ),
          )
          .orderBy(
            asc(equipmentInspectionRecordAttachments.sortOrder),
            asc(equipmentInspectionRecordAttachments.createdAt),
            asc(equipmentInspectionRecordAttachments.id),
          )

        const criterionPhotoIds = [
          ...new Set(criteria.flatMap((criterion) => criterion.photoAttachmentIds ?? [])),
        ]
        const criterionPhotos =
          criterionPhotoIds.length === 0
            ? []
            : await tx
                .select({
                  id: attachments.id,
                  filename: attachments.filename,
                  caption: attachments.caption,
                  r2Key: attachments.r2Key,
                  annotations: attachments.annotations,
                  width: attachments.width,
                  height: attachments.height,
                })
                .from(attachments)
                .where(
                  and(
                    eq(attachments.tenantId, ctx.tenantId),
                    eq(attachments.kind, 'image'),
                    inArray(attachments.id, criterionPhotoIds),
                  ),
                )

        return { head, criteria, recordPhotos, criterionPhotos }
      })
      if (!loaded) return {}
      const { head, criteria } = loaded
      const r = head.r
      const photosById = new Map(loaded.recordPhotos.map((photo) => [photo.id, photo] as const))
      for (const photo of loaded.criterionPhotos) {
        if (!photosById.has(photo.id)) photosById.set(photo.id, photo)
      }

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
        equipment_division:
          typeof head.equipmentMetadata?.division === 'string'
            ? head.equipmentMetadata.division
            : '',
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
        foreman_person_ids: r.foremanPersonIds.join(','),
        // Collections.
        criteria: criteria.map((c) => ({
          group: c.groupLabel ?? '',
          question: c.question ?? '',
          answer: answerLabel(c.answer) || (c.textValue ?? '') || (c.numericValue ?? ''),
          severity: titleize(c.severity),
          comment: c.comment ?? '',
          action_taken: c.actionTaken ?? '',
        })),
        photos: await Promise.all(
          [...photosById.values()].map(async (p) => {
            const url = await presignGet({ key: p.r2Key, expiresInSeconds: 900 })
            return {
              url: photoDocumentUrl({
                url,
                annotations: p.annotations,
                width: p.width,
                height: p.height,
              }),
              caption: p.caption ?? '',
            }
          }),
        ),
      }
    },

    async resolveSubmitter() {
      return ctx.db(async (tx) => {
        const [r] = await tx
          .select({
            submittedBy: equipmentInspectionRecords.submittedByTenantUserId,
            inspector: equipmentInspectionRecords.inspectorTenantUserId,
            inspectorPersonId: equipmentInspectionRecords.inspectorPersonId,
          })
          .from(equipmentInspectionRecords)
          .where(
            and(
              eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
              eq(equipmentInspectionRecords.id, recordId),
              isNull(equipmentInspectionRecords.deletedAt),
            ),
          )
          .limit(1)
        let tuid = r?.submittedBy ?? r?.inspector ?? null
        if (!tuid && r?.inspectorPersonId) {
          const [linked] = await tx
            .select({ tenantUserId: tenantUsers.id })
            .from(people)
            .innerJoin(
              tenantUsers,
              and(eq(tenantUsers.tenantId, people.tenantId), eq(tenantUsers.userId, people.userId)),
            )
            .where(eq(people.id, r.inspectorPersonId))
            .limit(1)
          tuid = linked?.tenantUserId ?? null
        }
        if (!tuid) return { tenantUserId: null, email: null, userId: null }
        const [u] = await tx
          .select({ email: users.email, userId: users.id })
          .from(tenantUsers)
          .innerJoin(users, eq(users.id, tenantUsers.userId))
          .where(
            and(
              eq(tenantUsers.tenantId, ctx.tenantId),
              eq(tenantUsers.id, tuid),
              eq(tenantUsers.status, 'active'),
            ),
          )
          .limit(1)
        return {
          tenantUserId: tuid,
          email: u?.email ?? null,
          userId: u?.userId ?? null,
        }
      })
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
        flowExecutionKey: i.flowExecutionKey,
      }),
  }
}
