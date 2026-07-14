import 'server-only'

// Inspections FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES.inspections.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  inspectionRecordAttachments,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { inspectionCriterionDisplayAnswer } from '@/lib/inspection-response-config'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, personName, titleize } from '../format'
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
      const customerOU = alias(orgUnits, 'insp_customer_ou')
      const contact = alias(people, 'insp_contact')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            r: inspectionRecords,
            typeName: inspectionTypes.name,
            siteName: orgUnits.name,
            inspectorName: inspU.name,
            supervisorName: supU.name,
            customerName: customerOU.name,
            contactFirst: contact.firstName,
            contactLast: contact.lastName,
            contactFormal: contact.formalName,
            customerSignatureKey: attachments.r2Key,
          })
          .from(inspectionRecords)
          .leftJoin(
            inspectionTypes,
            and(
              eq(inspectionTypes.tenantId, inspectionRecords.tenantId),
              eq(inspectionTypes.id, inspectionRecords.typeId),
            ),
          )
          .leftJoin(
            orgUnits,
            and(
              eq(orgUnits.tenantId, inspectionRecords.tenantId),
              eq(orgUnits.id, inspectionRecords.siteOrgUnitId),
            ),
          )
          .leftJoin(
            inspTU,
            and(
              eq(inspTU.tenantId, inspectionRecords.tenantId),
              eq(inspTU.id, inspectionRecords.inspectorTenantUserId),
            ),
          )
          .leftJoin(inspU, eq(inspU.id, inspTU.userId))
          .leftJoin(
            supTU,
            and(
              eq(supTU.tenantId, inspectionRecords.tenantId),
              eq(supTU.id, inspectionRecords.supervisorTenantUserId),
            ),
          )
          .leftJoin(supU, eq(supU.id, supTU.userId))
          .leftJoin(
            customerOU,
            and(
              eq(customerOU.tenantId, inspectionRecords.tenantId),
              eq(customerOU.id, inspectionRecords.customerOrgUnitId),
            ),
          )
          .leftJoin(
            contact,
            and(
              eq(contact.tenantId, inspectionRecords.tenantId),
              eq(contact.id, inspectionRecords.customerContactPersonId),
            ),
          )
          .leftJoin(
            attachments,
            and(
              eq(attachments.tenantId, inspectionRecords.tenantId),
              eq(attachments.id, inspectionRecords.customerSignatureAttachmentId),
              eq(attachments.kind, 'signature'),
            ),
          )
          .where(
            and(
              eq(inspectionRecords.tenantId, ctx.tenantId),
              eq(inspectionRecords.id, recordId),
              isNull(inspectionRecords.deletedAt),
            ),
          )
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
              responseType: inspectionRecordCriteria.responseType,
              answer: inspectionRecordCriteria.answer,
              choiceOptions: inspectionRecordCriteria.choiceOptionsSnapshot,
              choiceAnswer: inspectionRecordCriteria.choiceAnswer,
              textAnswer: inspectionRecordCriteria.textAnswer,
              numberAnswer: inspectionRecordCriteria.numberAnswer,
              severity: inspectionRecordCriteria.severity,
              nonCompliance: inspectionRecordCriteria.nonComplianceDescription,
              actionTaken: inspectionRecordCriteria.actionTaken,
            })
            .from(inspectionRecordCriteria)
            .where(
              and(
                eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
                eq(inspectionRecordCriteria.recordId, recordId),
              ),
            )
            .orderBy(asc(inspectionRecordCriteria.sequence)),
        ),
        ctx.db((tx) =>
          tx
            .select({ caption: inspectionRecordAttachments.caption, r2Key: attachments.r2Key })
            .from(inspectionRecordAttachments)
            .innerJoin(
              attachments,
              and(
                eq(attachments.tenantId, inspectionRecordAttachments.tenantId),
                eq(attachments.id, inspectionRecordAttachments.attachmentId),
                eq(attachments.kind, 'image'),
              ),
            )
            .where(
              and(
                eq(inspectionRecordAttachments.tenantId, ctx.tenantId),
                eq(inspectionRecordAttachments.recordId, recordId),
              ),
            ),
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
        foreman_text: r.foremanText ?? '',
        notes: r.notes ?? '',
        submitted_at: fmtDateTime(r.submittedAt),
        closed_at: fmtDateTime(r.closedAt),
        // Customer sign-off block (record-page parity): who the inspection was
        // for, who signed, and the drawn signature as a PNG data URL.
        customer_name: head.customerName ?? '',
        customer_contact_name:
          personName({
            firstName: head.contactFirst,
            lastName: head.contactLast,
            formalName: head.contactFormal,
          }) ||
          r.customerContactName ||
          '',
        customer_signer_name: r.customerSignerName ?? '',
        customer_signed_at: fmtDateTime(r.customerSignedAt),
        customer_signature_image: head.customerSignatureKey
          ? await presignGet({ key: head.customerSignatureKey, expiresInSeconds: 900 })
          : '',
        // FK ids for conditions / recipient `field` targets.
        type_id: r.typeId ?? null,
        site_org_unit_id: r.siteOrgUnitId ?? null,
        inspector_tenant_user_id: r.inspectorTenantUserId ?? null,
        // Collections.
        criteria: criteria.map((c) => ({
          group: c.groupLabel ?? '',
          question: c.question ?? '',
          response_type: c.responseType,
          options: c.choiceOptions.join(' | '),
          answer:
            inspectionCriterionDisplayAnswer({
              responseType: c.responseType,
              outcomeAnswer: c.answer,
              choiceAnswer: c.choiceAnswer,
              textAnswer: c.textAnswer,
              numberAnswer: c.numberAnswer,
            }) ?? '',
          severity: titleize(c.severity),
          non_compliance: c.nonCompliance ?? '',
          action_taken: c.actionTaken ?? '',
        })),
        photos: await Promise.all(
          photos.map(async (p) => ({
            url: await presignGet({ key: p.r2Key, expiresInSeconds: 900 }),
            caption: p.caption ?? '',
          })),
        ),
      }
    },

    async resolveSubmitter() {
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: inspectionRecords.inspectorTenantUserId })
          .from(inspectionRecords)
          .where(
            and(
              eq(inspectionRecords.tenantId, ctx.tenantId),
              eq(inspectionRecords.id, recordId),
              isNull(inspectionRecords.deletedAt),
            ),
          )
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
            .where(and(eq(tenantUsers.tenantId, ctx.tenantId), eq(tenantUsers.id, tuid)))
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
        flowExecutionKey: i.flowExecutionKey,
      }),
  }
}
