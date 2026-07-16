import 'server-only'

// Hazard Assessments (HazID) FlowSubjectAdapter. Field-map keys mirror
// MODULE_FLOW_PROFILES.hazid.

import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  attachments,
  hazidAssessmentHazards,
  hazidAssessmentPhotos,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidTasks,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { fmtDateTime, personName, yesBlank, yesNo } from '../format'
import type { FlowSubjectAdapter } from '../types'

function riskScore(l: number | null, s: number | null): number | string {
  return l != null && s != null ? l * s : ''
}

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
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: assessmentId,
        entityType: 'hazid_assessment',
        heading: 'Hazard assessment',
        reference: values.reference,
        subtitle: values.type_name,
        values,
      }),

    async loadValues() {
      // Header + resolved joins (site / project / type / supervisor / reporter),
      // mirroring the PDF loader so email templates reach the same data parity.
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            a: hazidAssessments,
            typeName: hazidAssessmentTypes.name,
            typeStyle: hazidAssessmentTypes.style,
            typeHasPPE: hazidAssessmentTypes.hasPPE,
            typeHasQuestions: hazidAssessmentTypes.hasQuestions,
            siteName: orgUnits.name,
            supFirst: people.firstName,
            supLast: people.lastName,
            supFormal: people.formalName,
          })
          .from(hazidAssessments)
          .leftJoin(
            hazidAssessmentTypes,
            eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
          )
          .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
          .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
          .where(eq(hazidAssessments.id, assessmentId))
          .limit(1),
      )
      if (!head) return {}
      const a = head.a

      const [proj] = a.projectOrgUnitId
        ? await ctx.db((tx) =>
            tx
              .select({ name: orgUnits.name, metadata: orgUnits.metadata })
              .from(orgUnits)
              .where(eq(orgUnits.id, a.projectOrgUnitId!))
              .limit(1),
          )
        : [null]

      const [reporter] = a.reportedByTenantUserId
        ? await ctx.db((tx) =>
            tx
              .select({ name: users.name, personId: people.id })
              .from(tenantUsers)
              .innerJoin(users, eq(users.id, tenantUsers.userId))
              .leftJoin(
                people,
                and(
                  eq(people.tenantId, tenantUsers.tenantId),
                  eq(people.userId, tenantUsers.userId),
                ),
              )
              .where(eq(tenantUsers.id, a.reportedByTenantUserId!))
              .limit(1),
          )
        : [null]

      const [tasks, hazards, ppe, questions, signatures, photos] = await Promise.all([
        ctx.db((tx) =>
          tx
            .select({
              description: hazidAssessmentTasks.description,
              controls: hazidAssessmentTasks.controls,
              hazardIds: hazidAssessmentTasks.hazardIds,
              libName: hazidTasks.name,
            })
            .from(hazidAssessmentTasks)
            .leftJoin(hazidTasks, eq(hazidTasks.id, hazidAssessmentTasks.taskId))
            .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
            .orderBy(asc(hazidAssessmentTasks.entityOrder)),
        ),
        ctx.db((tx) =>
          tx
            .select({ row: hazidAssessmentHazards, libName: hazidHazards.name })
            .from(hazidAssessmentHazards)
            .leftJoin(hazidHazards, eq(hazidHazards.id, hazidAssessmentHazards.hazardId))
            .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
            .orderBy(asc(hazidAssessmentHazards.entityOrder)),
        ),
        ctx.db((tx) =>
          tx
            .select()
            .from(hazidAssessmentPPE)
            .where(eq(hazidAssessmentPPE.assessmentId, assessmentId))
            .orderBy(asc(hazidAssessmentPPE.entityOrder)),
        ),
        ctx.db((tx) =>
          tx
            .select()
            .from(hazidAssessmentQuestions)
            .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
            .orderBy(asc(hazidAssessmentQuestions.entityOrder)),
        ),
        ctx.db((tx) =>
          tx
            .select({
              row: hazidAssessmentSignatures,
              pFirst: people.firstName,
              pLast: people.lastName,
              pFormal: people.formalName,
              signatureKey: attachments.r2Key,
            })
            .from(hazidAssessmentSignatures)
            .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
            .leftJoin(
              attachments,
              eq(attachments.id, hazidAssessmentSignatures.signatureAttachmentId),
            )
            .where(eq(hazidAssessmentSignatures.assessmentId, assessmentId)),
        ),
        ctx.db((tx) =>
          tx
            .select({ caption: hazidAssessmentPhotos.caption, r2Key: attachments.r2Key })
            .from(hazidAssessmentPhotos)
            .innerJoin(attachments, eq(attachments.id, hazidAssessmentPhotos.attachmentId))
            .where(eq(hazidAssessmentPhotos.assessmentId, assessmentId)),
        ),
      ])

      const taskHazardIds = [...new Set(tasks.flatMap((t) => t.hazardIds))]
      const taskHazards =
        taskHazardIds.length > 0
          ? await ctx.db((tx) =>
              tx
                .select({ id: hazidHazards.id, name: hazidHazards.name })
                .from(hazidHazards)
                .where(inArray(hazidHazards.id, taskHazardIds)),
            )
          : []
      const taskHazardLookup = new Map(taskHazards.map((h) => [h.id, h.name]))

      return {
        reference: a.reference ?? null,
        job_scope: a.jobScope ?? null,
        location_on_site: a.locationOnSite ?? null,
        locked: a.locked ?? null,
        in_progress: a.inProgress ?? null,
        status_label: a.locked ? 'Locked' : a.inProgress ? 'In progress' : 'Open',
        occurred_at: fmtDateTime(a.occurredAt),
        locked_at: fmtDateTime(a.lockedAt),
        site_name: head.siteName ?? '',
        project_name: proj?.name ?? '',
        type_name: head.typeName ?? '',
        // Section-visibility flags derived from the assessment type, matching
        // the bespoke PDF's sections logic (style + hasPPE/hasQuestions,
        // defaulting to a task-based layout when no type is set). Templates
        // gate the matching blocks with {{#if show_…}}.
        show_job_scope: (head.typeStyle ?? 'task_based') === 'hazard_based',
        show_ppe: head.typeHasPPE ?? true,
        show_questions: head.typeHasQuestions ?? true,
        show_tasks: (head.typeStyle ?? 'task_based') === 'task_based',
        show_hazards: (head.typeStyle ?? 'task_based') === 'hazard_based',
        supervisor_name: personName({
          firstName: head.supFirst,
          lastName: head.supLast,
          formalName: head.supFormal,
        }),
        reported_by_name: reporter?.name ?? '',
        // FK ids for conditions / recipient `field` targets.
        site_org_unit_id: a.siteOrgUnitId ?? null,
        project_org_unit_id: a.projectOrgUnitId ?? null,
        project_superintendent_person_id:
          typeof proj?.metadata?.superintendentPersonId === 'string'
            ? proj.metadata.superintendentPersonId
            : null,
        project_foreman_person_id:
          typeof proj?.metadata?.foremanPersonId === 'string'
            ? proj.metadata.foremanPersonId
            : null,
        supervisor_person_id: a.supervisorPersonId ?? null,
        reported_by_person_id: reporter?.personId ?? null,
        assessment_type_id: a.assessmentTypeId ?? null,
        // Collections — rendered via {{#each …}} tables.
        tasks: tasks.map((t) => ({
          name: t.libName ?? t.description ?? 'Task',
          hazards: t.hazardIds
            .map((id) => taskHazardLookup.get(id))
            .filter((name): name is string => Boolean(name)),
          hazard_names: t.hazardIds
            .map((id) => taskHazardLookup.get(id))
            .filter((name): name is string => Boolean(name))
            .join(', '),
          controls: t.controls ?? '',
        })),
        hazards: hazards.map((h) => ({
          name: h.libName ?? h.row.name ?? 'Hazard',
          standard_controls: h.row.standardControls ?? '',
          specific_controls: h.row.specificControls ?? '',
          controls: h.row.controls ?? '',
          applicable: yesNo(h.row.applicable),
          pre_likelihood: h.row.preLikelihood ?? '',
          pre_severity: h.row.preSeverity ?? '',
          pre_risk: riskScore(h.row.preLikelihood, h.row.preSeverity),
          post_likelihood: h.row.postLikelihood ?? '',
          post_severity: h.row.postSeverity ?? '',
          post_risk: riskScore(h.row.postLikelihood, h.row.postSeverity),
        })),
        ppe: ppe.map((p) => ({
          name: p.name ?? '',
          description: p.description ?? '',
          required: yesNo(p.required),
          answer: p.answer ? p.answer.toUpperCase() : '',
        })),
        questions: questions.map((q) => ({
          question: q.question ?? '',
          answer: q.answer ?? '',
          requires_yes: yesNo(q.requiresYes),
        })),
        signatures: await Promise.all(
          signatures.map(async (s) => ({
            name:
              personName({ firstName: s.pFirst, lastName: s.pLast, formalName: s.pFormal }) ||
              s.row.externalName ||
              'Unknown',
            type: s.row.signatureType,
            cs_entrant: yesBlank(s.row.csEntrant),
            cs_attendant: yesBlank(s.row.csAttendant),
            cs_rescue: yesBlank(s.row.csRescue),
            signed_at: fmtDateTime(s.row.signedAt),
            attachment_id: s.row.signatureAttachmentId ?? null,
            image: s.signatureKey
              ? await presignGet({ key: s.signatureKey, expiresInSeconds: 900 })
              : '',
          })),
        ),
        photos: await Promise.all(
          photos.map(async (p) => ({
            url: await presignGet({ key: p.r2Key, expiresInSeconds: 900 }),
            caption: p.caption ?? '',
          })),
        ),
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
        flowExecutionKey: i.flowExecutionKey,
      }),
  }
}
