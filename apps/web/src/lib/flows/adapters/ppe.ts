import 'server-only'

// PPE inspection FlowSubjectAdapter — subject = one ppe_inspections row (the
// legacy "PPE Inspection (date)" email fires when an inspection is recorded).
// Field-map keys mirror MODULE_FLOW_PROFILES.ppe.
//
// The PPE model derives the overall result from immutable per-criterion
// snapshots. The flow subject currently exposes the record-level fields used
// by the PPE automation profile; the detail UI retains the full evidence.

import { asc, eq, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  orgUnits,
  people,
  ppeInspectionAttachments,
  ppeInspectionCriteria,
  ppeInspections,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'
import { recordPpeIssueAction } from '@/app/(app)/ppe/_lib'

// `people` is already joined for the holder, so the supervisor needs its own
// alias or the two would collapse onto the same row.
const supervisorPeople = alias(people, 'supervisor_people')

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
            supervisorFirst: supervisorPeople.firstName,
            supervisorLast: supervisorPeople.lastName,
            supervisorFormal: supervisorPeople.formalName,
            siteName: orgUnits.name,
          })
          .from(ppeInspections)
          .innerJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
          .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, ppeInspections.inspectedByTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .leftJoin(supervisorPeople, eq(supervisorPeople.id, ppeInspections.supervisorPersonId))
          .leftJoin(orgUnits, eq(orgUnits.id, ppeInspections.siteOrgUnitId))
          .where(eq(ppeInspections.id, inspectionId))
          .limit(1),
      )
      if (!head) return {}
      const i = head.i
      const item = head.item
      const [criteria, photos] = await Promise.all([
        ctx.db((tx) =>
          tx
            .select({
              question: ppeInspectionCriteria.questionTextSnapshot,
              answer: ppeInspectionCriteria.answer,
              severity: ppeInspectionCriteria.severity,
              nonCompliance: ppeInspectionCriteria.nonComplianceReason,
            })
            .from(ppeInspectionCriteria)
            .where(eq(ppeInspectionCriteria.inspectionId, inspectionId))
            .orderBy(asc(ppeInspectionCriteria.sequence)),
        ),
        ctx.db((tx) =>
          tx
            .select({
              caption: ppeInspectionAttachments.caption,
              criterionQuestion: ppeInspectionCriteria.questionTextSnapshot,
              r2Key: attachments.r2Key,
            })
            .from(ppeInspectionAttachments)
            .innerJoin(attachments, eq(attachments.id, ppeInspectionAttachments.attachmentId))
            .leftJoin(
              ppeInspectionCriteria,
              eq(ppeInspectionCriteria.id, ppeInspectionAttachments.criterionResultId),
            )
            .where(
              or(
                eq(ppeInspectionAttachments.inspectionId, inspectionId),
                eq(ppeInspectionCriteria.inspectionId, inspectionId),
              ),
            ),
        ),
      ])

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
        item_status: item.status,
        holder_name: personName({
          firstName: head.holderFirst,
          lastName: head.holderLast,
          formalName: head.holderFormal,
        }),
        inspector_name: i.inspectorNameSnapshot ?? head.inspectorName ?? '',
        supervisor_name: personName({
          firstName: head.supervisorFirst,
          lastName: head.supervisorLast,
          formalName: head.supervisorFormal,
        }),
        site_name: head.siteName ?? '',
        // FK ids for conditions / recipient `field` targets.
        item_id: i.itemId ?? null,
        type_id: item.typeId ?? null,
        site_org_unit_id: i.siteOrgUnitId ?? null,
        holder_person_id: item.currentHolderPersonId ?? null,
        inspected_by_tenant_user_id: i.inspectedByTenantUserId ?? null,
        supervisor_person_id: i.supervisorPersonId ?? null,
        criteria: criteria.map((criterion) => ({
          question: criterion.question,
          answer: criterion.answer === 'n_a' ? 'N/A' : titleize(criterion.answer),
          severity: titleize(criterion.severity),
          non_compliance: criterion.nonCompliance ?? '',
        })),
        photos: await Promise.all(
          photos.map(async (photo) => ({
            url: await presignGet({ key: photo.r2Key, expiresInSeconds: 900 }),
            caption: photo.caption ?? photo.criterionQuestion ?? '',
          })),
        ),
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
        flowExecutionKey: i.flowExecutionKey,
      }),

    async persistAfterRun({ fieldPatch }) {
      const keys = Object.keys(fieldPatch)
      if (keys.length !== 1 || keys[0] !== 'item_status') {
        throw new Error('PPE inspection Flows may only update the related PPE item status.')
      }
      const status = fieldPatch.item_status
      if (
        !['in_stock', 'issued', 'returned', 'out_of_service', 'discarded', 'expired'].includes(
          String(status),
        )
      ) {
        throw new Error('The PPE item status selected by this Flow is invalid.')
      }
      const [inspection] = await ctx.db((tx) =>
        tx
          .select({ itemId: ppeInspections.itemId })
          .from(ppeInspections)
          .where(eq(ppeInspections.id, inspectionId))
          .limit(1),
      )
      if (!inspection) throw new Error('The PPE inspection no longer exists.')
      // Route through the shared transition so a Flow-driven status change is
      // as visible and attributable in History as a human one. Issuing needs a
      // holder, which a Flow cannot supply, so it is not offered here.
      const ACTION_FOR_STATUS = {
        returned: 'return',
        out_of_service: 'mark_out_of_service',
        discarded: 'discard',
        in_stock: 'return_to_stock',
        expired: 'expire',
      } as const
      const action = ACTION_FOR_STATUS[status as keyof typeof ACTION_FOR_STATUS]
      if (!action) {
        throw new Error('A Flow cannot issue PPE — it has no holder to issue to.')
      }
      await recordPpeIssueAction(ctx, {
        itemId: inspection.itemId,
        personId: null,
        action,
        note: `Set by a Flow on inspection ${inspectionId}`,
      })
    },
  }
}
