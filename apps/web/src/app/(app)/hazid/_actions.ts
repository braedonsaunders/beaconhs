'use server'

// All server actions used by the HazID detail page and its sub-sections.
// Keep these co-located so the detail page wiring is straightforward and the
// audit-log call is consistent.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { asc, count, eq, max, sql } from 'drizzle-orm'
import { enqueueEmail, enqueuePdf } from '@beaconhs/jobs'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import {
  attachments,
  hazidAssessmentCSAtmospheric,
  hazidAssessmentCSEntries,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidHazardSets,
  hazidHazardTypes,
  hazidLocationTasks,
  hazidSignedReports,
  hazidTasks,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

// All HazID server actions assume a tenant is active. requireRequestContext
// types tenantId as string | null because some admin pages run pre-tenant —
// but every page below /hazid is tenant-scoped, so we narrow once here.
type HazidCtx = Omit<RequestContext, 'tenantId'> & { tenantId: string }

async function ctxWithTenant(): Promise<HazidCtx> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('Active tenant required')
  return ctx as HazidCtx
}

const PATHS = (id: string) => [`/hazid/${id}`, '/hazid']

function revalidateAssessment(id: string) {
  for (const p of PATHS(id)) revalidatePath(p)
}

// ------------------------------------------------------------------
// Assessment CRUD
// ------------------------------------------------------------------

export async function createAssessment(formData: FormData): Promise<{ id: string }> {
  const ctx = await ctxWithTenant()
  const assessmentTypeId = String(formData.get('assessmentTypeId') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const projectOrgUnitId = String(formData.get('projectOrgUnitId') ?? '').trim() || null
  const locationOnSite = String(formData.get('locationOnSite') ?? '').trim() || null
  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const supervisorPersonId = String(formData.get('supervisorPersonId') ?? '').trim() || null
  const jobScope = String(formData.get('jobScope') ?? '').trim() || null
  const copyFromId = String(formData.get('copyFromId') ?? '').trim() || null

  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date()
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid occurred date/time')

  const created = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const counted = await tx
      .select({ c: count() })
      .from(hazidAssessments)
      .where(sql`extract(year from ${hazidAssessments.createdAt}) = ${year}`)
    const c = counted[0]?.c ?? 0
    const reference = `HAZ-${year}-${String(Number(c) + 1).padStart(4, '0')}`

    const [row] = await tx
      .insert(hazidAssessments)
      .values({
        tenantId: ctx.tenantId,
        reference,
        occurredAt,
        siteOrgUnitId,
        projectOrgUnitId,
        locationOnSite,
        supervisorPersonId,
        supervisorTenantUserId: null,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        assessmentTypeId,
        jobScope,
        inProgress: true,
      })
      .returning()
    if (!row) throw new Error('Failed to create assessment')

    // Optionally seed from the assessment-type defaults.
    if (assessmentTypeId) {
      const [type] = await tx
        .select()
        .from(hazidAssessmentTypes)
        .where(eq(hazidAssessmentTypes.id, assessmentTypeId))
        .limit(1)
      if (type) {
        // Default PPE
        const typePPE = await tx
          .select()
          .from(hazidAssessmentTypePPE)
          .where(eq(hazidAssessmentTypePPE.typeId, type.id))
          .orderBy(asc(hazidAssessmentTypePPE.entityOrder))
        if (typePPE.length > 0) {
          await tx.insert(hazidAssessmentPPE).values(
            typePPE.map((p) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              name: p.name,
              description: p.description,
              required: p.required,
              entityOrder: p.entityOrder,
            })),
          )
        }
        // Default questions
        const typeQ = await tx
          .select()
          .from(hazidAssessmentTypeQuestions)
          .where(eq(hazidAssessmentTypeQuestions.typeId, type.id))
          .orderBy(asc(hazidAssessmentTypeQuestions.entityOrder))
        if (typeQ.length > 0) {
          await tx.insert(hazidAssessmentQuestions).values(
            typeQ.map((q) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              question: q.question,
              questionType: q.questionType,
              answers: q.answers,
              requiresYes: q.requiresYes,
              entityOrder: q.entityOrder,
            })),
          )
        }
        // Default hazards from the type's default hazard set
        if (type.defaultHazardSetId) {
          const [set] = await tx
            .select()
            .from(hazidHazardSets)
            .where(eq(hazidHazardSets.id, type.defaultHazardSetId))
            .limit(1)
          if (set && set.hazardIds.length > 0) {
            const hazRows = await tx
              .select()
              .from(hazidHazards)
              .where(sql`${hazidHazards.id} = ANY(${set.hazardIds})`)
            if (hazRows.length > 0) {
              await tx.insert(hazidAssessmentHazards).values(
                hazRows.map((h, i) => ({
                  tenantId: ctx.tenantId,
                  assessmentId: row.id,
                  hazardId: h.id,
                  standardControls: h.standardControls,
                  entityOrder: i + 1,
                })),
              )
            }
          }
        }
        // Location task suggestions
        if (siteOrgUnitId) {
          const locTasks = await tx
            .select({ task: hazidTasks })
            .from(hazidLocationTasks)
            .innerJoin(hazidTasks, eq(hazidTasks.id, hazidLocationTasks.taskId))
            .where(eq(hazidLocationTasks.orgUnitId, siteOrgUnitId))
          if (locTasks.length > 0) {
            await tx.insert(hazidAssessmentTasks).values(
              locTasks.map((row2, i) => ({
                tenantId: ctx.tenantId,
                assessmentId: row.id,
                taskId: row2.task.id,
                hazardIds: row2.task.hazardIds,
                controls: row2.task.controls,
                entityOrder: i + 1,
              })),
            )
          }
        }
      }
    }

    // Optionally copy from an existing assessment.
    if (copyFromId) {
      const [src] = await tx
        .select()
        .from(hazidAssessments)
        .where(eq(hazidAssessments.id, copyFromId))
        .limit(1)
      if (src) {
        await tx
          .update(hazidAssessments)
          .set({
            jobScope: src.jobScope,
            locationOnSite: src.locationOnSite,
            wah: src.wah,
            wahType: src.wahType,
            wahCommunication: src.wahCommunication,
            wahAccess: src.wahAccess,
            wahEquipment: src.wahEquipment,
            wahRescue: src.wahRescue,
            confinedSpace: src.confinedSpace,
            csType: src.csType,
            csDescription: src.csDescription,
            csCommunication: src.csCommunication,
            csCommunicationRescue: src.csCommunicationRescue,
            csRescue: src.csRescue,
            csWorkPerformed: src.csWorkPerformed,
            csRescueProcedure: src.csRescueProcedure,
            csRescueStyle: src.csRescueStyle,
            arcFlash: src.arcFlash,
            arcFlashLevel: src.arcFlashLevel,
            arcFlashBoundary: src.arcFlashBoundary,
            arcFlashIncidentEnergy: src.arcFlashIncidentEnergy,
            arcFlashEquipment: src.arcFlashEquipment,
            arcFlashProcedures: src.arcFlashProcedures,
            arcFlashQualifiedPerson: src.arcFlashQualifiedPerson,
          })
          .where(eq(hazidAssessments.id, row.id))

        // Copy children (tasks, hazards, ppe, questions). Skip signatures
        // and photos.
        const srcTasks = await tx
          .select()
          .from(hazidAssessmentTasks)
          .where(eq(hazidAssessmentTasks.assessmentId, src.id))
        if (srcTasks.length > 0) {
          await tx.delete(hazidAssessmentTasks).where(eq(hazidAssessmentTasks.assessmentId, row.id))
          await tx.insert(hazidAssessmentTasks).values(
            srcTasks.map((t) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              taskId: t.taskId,
              description: t.description,
              hazardIds: t.hazardIds,
              controls: t.controls,
              entityOrder: t.entityOrder,
            })),
          )
        }
        const srcHaz = await tx
          .select()
          .from(hazidAssessmentHazards)
          .where(eq(hazidAssessmentHazards.assessmentId, src.id))
        if (srcHaz.length > 0) {
          await tx.delete(hazidAssessmentHazards).where(eq(hazidAssessmentHazards.assessmentId, row.id))
          await tx.insert(hazidAssessmentHazards).values(
            srcHaz.map((h) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              hazardId: h.hazardId,
              name: h.name,
              standardControls: h.standardControls,
              specificControls: h.specificControls,
              applicable: h.applicable,
              entityOrder: h.entityOrder,
            })),
          )
        }
        const srcPPE = await tx
          .select()
          .from(hazidAssessmentPPE)
          .where(eq(hazidAssessmentPPE.assessmentId, src.id))
        if (srcPPE.length > 0) {
          await tx.delete(hazidAssessmentPPE).where(eq(hazidAssessmentPPE.assessmentId, row.id))
          await tx.insert(hazidAssessmentPPE).values(
            srcPPE.map((p) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              name: p.name,
              description: p.description,
              required: p.required,
              entityOrder: p.entityOrder,
            })),
          )
        }
        const srcQ = await tx
          .select()
          .from(hazidAssessmentQuestions)
          .where(eq(hazidAssessmentQuestions.assessmentId, src.id))
        if (srcQ.length > 0) {
          await tx.delete(hazidAssessmentQuestions).where(eq(hazidAssessmentQuestions.assessmentId, row.id))
          await tx.insert(hazidAssessmentQuestions).values(
            srcQ.map((q) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              question: q.question,
              questionType: q.questionType,
              answers: q.answers,
              requiresYes: q.requiresYes,
              entityOrder: q.entityOrder,
            })),
          )
        }
      }
    }

    return row
  })

  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: created.id,
    action: 'create',
    summary: `Created ${created.reference}`,
    after: { reference: created.reference, assessmentTypeId, siteOrgUnitId },
  })
  revalidatePath('/hazid')
  return { id: created.id }
}

export async function updateGeneral(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing id')

  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : undefined
  const updates: Record<string, unknown> = {
    siteOrgUnitId: nullable(formData.get('siteOrgUnitId')),
    projectOrgUnitId: nullable(formData.get('projectOrgUnitId')),
    locationOnSite: nullable(formData.get('locationOnSite')),
    supervisorPersonId: nullable(formData.get('supervisorPersonId')),
    assessmentTypeId: nullable(formData.get('assessmentTypeId')),
  }
  if (occurredAt && !Number.isNaN(occurredAt.getTime())) updates.occurredAt = occurredAt

  await ctx.db((tx) => tx.update(hazidAssessments).set(updates).where(eq(hazidAssessments.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'update',
    summary: 'Updated general information',
    after: updates,
  })
  revalidateAssessment(id)
}

export async function updateTextField(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const value = nullable(formData.get('value'))
  if (!id || !field) throw new Error('Missing id/field')
  const ALLOWED = new Set([
    'jobScope',
    'wahRescue',
    'wahPermitNumber',
    'wahType',
    'wahAccess',
    'wahEquipment',
    'wahCommunication',
    'csDescription',
    'csWorkPerformed',
    'csRescueProcedure',
    'csDiagramBase64',
    'csPermitNumber',
    'csType',
    'csRescueStyle',
    'csCommunication',
    'csCommunicationRescue',
    'csRescue',
    'arcFlashLevel',
    'arcFlashBoundary',
    'arcFlashIncidentEnergy',
    'arcFlashEquipment',
    'arcFlashProcedures',
    'arcFlashQualifiedPerson',
    'wah',
    'confinedSpace',
    'arcFlash',
  ])
  if (!ALLOWED.has(field)) throw new Error('Field not allowed')

  // Booleans (toggles) come in as "on" / "off" / "true" / "false".
  const BOOLS = new Set(['wah', 'confinedSpace', 'arcFlash'])
  // Array-string fields (multi-select text) come comma-separated.
  const ARRAYS = new Set([
    'wahCommunication',
    'wahAccess',
    'wahEquipment',
    'csCommunication',
    'csCommunicationRescue',
    'csRescue',
    'arcFlashEquipment',
  ])

  let val: unknown = value
  if (BOOLS.has(field)) val = value === 'on' || value === 'true' || value === '1'
  if (ARRAYS.has(field)) {
    val = (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  await ctx.db((tx) =>
    tx
      .update(hazidAssessments)
      .set({ [field]: val } as any)
      .where(eq(hazidAssessments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidateAssessment(id)
}

export async function lockAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(hazidAssessments)
      .set({
        locked: true,
        inProgress: false,
        lockedAt: new Date(),
        lockedByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(eq(hazidAssessments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'update',
    summary: 'Locked',
  })
  revalidateAssessment(id)
}

export async function unlockAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db(async (tx) => {
    await tx
      .update(hazidAssessments)
      .set({
        locked: false,
        inProgress: true,
        lockedAt: null,
        lockedByTenantUserId: null,
      })
      .where(eq(hazidAssessments.id, id))
    // Legacy parity: clear all signatures on unlock so they must be re-collected.
    await tx
      .update(hazidAssessmentSignatures)
      .set({ signatureDataUrl: null, signedAt: null })
      .where(eq(hazidAssessmentSignatures.assessmentId, id))
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'update',
    summary: 'Unlocked (signatures cleared)',
  })
  revalidateAssessment(id)
}

export async function deleteAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(hazidAssessments)
      .set({ deletedAt: new Date() })
      .where(eq(hazidAssessments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted assessment',
  })
  revalidatePath('/hazid')
}

// Duplicate an existing assessment as a fresh draft. Common workflow when the
// next job is similar to the previous one — copy the prior assessment, rename,
// tweak. We copy:
//   • the assessment row (new id, new reference, fresh occurred_at = now,
//     unlocked, job-scope suffixed with "(copy)" if non-empty)
//   • all hazards (with their pre/post risk ratings + controls)
//   • all tasks
//   • all PPE rows (without the user's prior yes/no/na answers)
//   • all questions (without the user's prior answer)
// We deliberately do NOT copy:
//   • signatures (every assessment needs its own sign-off)
//   • photos / file attachments (those are job-specific evidence)
//   • CS atmospheric readings / entry log (job-specific data points)
//   • signed-report bundles (different lifecycle)
// After the copy we redirect to the new detail page.
export async function copyAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  const sourceId = String(formData.get('id') ?? '')
  if (!sourceId) throw new Error('Missing id')

  const created = await ctx.db(async (tx) => {
    const [src] = await tx
      .select()
      .from(hazidAssessments)
      .where(eq(hazidAssessments.id, sourceId))
      .limit(1)
    if (!src) throw new Error('Source assessment not found')

    // Reuse the same numbering scheme as createAssessment so references stay
    // consistent: HAZ-<year>-<counter>.
    const year = new Date().getFullYear()
    const counted = await tx
      .select({ c: count() })
      .from(hazidAssessments)
      .where(sql`extract(year from ${hazidAssessments.createdAt}) = ${year}`)
    const c = counted[0]?.c ?? 0
    const reference = `HAZ-${year}-${String(Number(c) + 1).padStart(4, '0')}`

    const jobScope = src.jobScope ? `${src.jobScope} (copy)` : '(copy)'

    const [row] = await tx
      .insert(hazidAssessments)
      .values({
        tenantId: ctx.tenantId,
        reference,
        occurredAt: new Date(),
        siteOrgUnitId: src.siteOrgUnitId,
        projectOrgUnitId: src.projectOrgUnitId,
        locationOnSite: src.locationOnSite,
        supervisorPersonId: src.supervisorPersonId,
        supervisorTenantUserId: src.supervisorTenantUserId,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        assessmentTypeId: src.assessmentTypeId,
        jobScope,
        // WAH
        wah: src.wah,
        wahType: src.wahType,
        wahCommunication: src.wahCommunication,
        wahAccess: src.wahAccess,
        wahEquipment: src.wahEquipment,
        wahRescue: src.wahRescue,
        wahPermitNumber: src.wahPermitNumber,
        // CS
        confinedSpace: src.confinedSpace,
        csType: src.csType,
        csDescription: src.csDescription,
        csCommunication: src.csCommunication,
        csCommunicationRescue: src.csCommunicationRescue,
        csRescue: src.csRescue,
        csWorkPerformed: src.csWorkPerformed,
        csDiagramBase64: src.csDiagramBase64,
        csRescueStyle: src.csRescueStyle,
        csRescueProcedure: src.csRescueProcedure,
        csAtmosphericSensorId: src.csAtmosphericSensorId,
        csPermitNumber: null, // permits are job-specific; force re-entry
        // Arc Flash
        arcFlash: src.arcFlash,
        arcFlashLevel: src.arcFlashLevel,
        arcFlashBoundary: src.arcFlashBoundary,
        arcFlashIncidentEnergy: src.arcFlashIncidentEnergy,
        arcFlashEquipment: src.arcFlashEquipment,
        arcFlashProcedures: src.arcFlashProcedures,
        arcFlashQualifiedPerson: src.arcFlashQualifiedPerson,
        // Lock state — always start as draft / in-progress.
        inProgress: true,
        locked: false,
      })
      .returning()
    if (!row) throw new Error('Failed to insert copied assessment')

    // Hazards — include pre/post risk ratings + controls.
    const srcHazards = await tx
      .select()
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentHazards.entityOrder))
    if (srcHazards.length > 0) {
      await tx.insert(hazidAssessmentHazards).values(
        srcHazards.map((h) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          hazardId: h.hazardId,
          name: h.name,
          standardControls: h.standardControls,
          specificControls: h.specificControls,
          applicable: h.applicable,
          entityOrder: h.entityOrder,
          preLikelihood: h.preLikelihood,
          preSeverity: h.preSeverity,
          controls: h.controls,
          postLikelihood: h.postLikelihood,
          postSeverity: h.postSeverity,
        })),
      )
    }

    // Tasks
    const srcTasks = await tx
      .select()
      .from(hazidAssessmentTasks)
      .where(eq(hazidAssessmentTasks.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    if (srcTasks.length > 0) {
      await tx.insert(hazidAssessmentTasks).values(
        srcTasks.map((t) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          taskId: t.taskId,
          description: t.description,
          hazardIds: t.hazardIds,
          controls: t.controls,
          entityOrder: t.entityOrder,
        })),
      )
    }

    // PPE — clear any prior yes/no/na answers; the new job re-answers.
    const srcPPE = await tx
      .select()
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentPPE.entityOrder))
    if (srcPPE.length > 0) {
      await tx.insert(hazidAssessmentPPE).values(
        srcPPE.map((p) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          name: p.name,
          description: p.description,
          required: p.required,
          entityOrder: p.entityOrder,
          answer: null,
        })),
      )
    }

    // Questions — clear any prior text answers.
    const srcQ = await tx
      .select()
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentQuestions.entityOrder))
    if (srcQ.length > 0) {
      await tx.insert(hazidAssessmentQuestions).values(
        srcQ.map((q) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          question: q.question,
          questionType: q.questionType,
          answers: q.answers,
          requiresYes: q.requiresYes,
          entityOrder: q.entityOrder,
          answer: null,
        })),
      )
    }

    return { row, src }
  })

  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: created.row.id,
    action: 'copy',
    summary: `Copied from ${created.src.reference} as ${created.row.reference}`,
    after: { copiedFrom: created.src.id, copiedFromReference: created.src.reference },
  })

  revalidatePath('/hazid')
  revalidatePath(`/hazid/${created.row.id}`)
  redirect(`/hazid/${created.row.id}` as any)
}

// ------------------------------------------------------------------
// Tasks
// ------------------------------------------------------------------
export async function addTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const taskId = String(formData.get('taskId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const controls = String(formData.get('controls') ?? '').trim() || null
  if (!assessmentId) throw new Error('Missing assessmentId')

  await ctx.db(async (tx) => {
    let hazardIds: string[] = []
    let nextControls = controls
    let nextDescription = description
    if (taskId) {
      const [t] = await tx.select().from(hazidTasks).where(eq(hazidTasks.id, taskId)).limit(1)
      if (t) {
        hazardIds = t.hazardIds
        if (!nextControls) nextControls = t.controls
        if (!nextDescription) nextDescription = t.name
      }
    }
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentTasks.entityOrder) })
      .from(hazidAssessmentTasks)
      .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
    const order = (maxOrder?.m ?? 0) + 1
    await tx.insert(hazidAssessmentTasks).values({
      tenantId: ctx.tenantId,
      assessmentId,
      taskId,
      description: nextDescription,
      hazardIds,
      controls: nextControls,
      entityOrder: order,
    })
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: taskId ? 'Added task from library' : 'Added ad-hoc task',
  })
  revalidateAssessment(assessmentId)
}

export async function updateTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const description = nullable(formData.get('description'))
  const controls = nullable(formData.get('controls'))
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTasks)
      .set({ description, controls })
      .where(eq(hazidAssessmentTasks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_task',
    entityId: id,
    action: 'update',
    summary: 'Updated task',
  })
  revalidateAssessment(assessmentId)
}

export async function deleteTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentTasks).where(eq(hazidAssessmentTasks.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_task',
    entityId: id,
    action: 'delete',
    summary: 'Deleted task',
  })
  revalidateAssessment(assessmentId)
}

export async function moveTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await reorderEntities(ctx, hazidAssessmentTasks, assessmentId, id, direction as 'up' | 'down')
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Hazards
// ------------------------------------------------------------------
export async function addHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const hazardId = String(formData.get('hazardId') ?? '').trim() || null
  const name = String(formData.get('name') ?? '').trim() || null
  if (!assessmentId) throw new Error('Missing assessmentId')

  await ctx.db(async (tx) => {
    let standardControls: string | null = null
    if (hazardId) {
      const [h] = await tx.select().from(hazidHazards).where(eq(hazidHazards.id, hazardId)).limit(1)
      standardControls = h?.standardControls ?? null
    }
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentHazards.entityOrder) })
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentHazards).values({
      tenantId: ctx.tenantId,
      assessmentId,
      hazardId,
      name,
      standardControls,
      applicable: true,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: hazardId ? 'Added hazard from library' : 'Added ad-hoc hazard',
  })
  revalidateAssessment(assessmentId)
}

export async function addHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const setId = String(formData.get('setId') ?? '')
  if (!assessmentId || !setId) throw new Error('Missing ids')
  await ctx.db(async (tx) => {
    const [set] = await tx
      .select()
      .from(hazidHazardSets)
      .where(eq(hazidHazardSets.id, setId))
      .limit(1)
    if (!set || set.hazardIds.length === 0) return
    const hazRows = await tx
      .select()
      .from(hazidHazards)
      .where(sql`${hazidHazards.id} = ANY(${set.hazardIds})`)
    if (hazRows.length === 0) return
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentHazards.entityOrder) })
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
    let next = (maxOrder?.m ?? 0) + 1
    await tx.insert(hazidAssessmentHazards).values(
      hazRows.map((h) => ({
        tenantId: ctx.tenantId,
        assessmentId,
        hazardId: h.id,
        standardControls: h.standardControls,
        applicable: true,
        entityOrder: next++,
      })),
    )
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: 'Added hazard set',
  })
  revalidateAssessment(assessmentId)
}

export async function updateHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const specificControls = nullable(formData.get('specificControls'))
  const applicable = formData.get('applicable') === 'on' || formData.get('applicable') === 'true'
  const standardControls = nullable(formData.get('standardControls'))
  const name = nullable(formData.get('name'))
  // Risk-rating fields are optional 1-5 ints; absent → leave the column alone,
  // empty → null it out, otherwise clamp into the valid range.
  const updates: Record<string, unknown> = { specificControls, applicable }
  if (standardControls !== undefined) updates.standardControls = standardControls
  if (name !== undefined) updates.name = name
  if (formData.has('preLikelihood')) updates.preLikelihood = riskRating(formData.get('preLikelihood'))
  if (formData.has('preSeverity')) updates.preSeverity = riskRating(formData.get('preSeverity'))
  if (formData.has('postLikelihood')) updates.postLikelihood = riskRating(formData.get('postLikelihood'))
  if (formData.has('postSeverity')) updates.postSeverity = riskRating(formData.get('postSeverity'))
  if (formData.has('controls')) updates.controls = nullable(formData.get('controls'))
  await ctx.db((tx) => tx.update(hazidAssessmentHazards).set(updates).where(eq(hazidAssessmentHazards.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_hazard',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard',
  })
  revalidateAssessment(assessmentId)
}

// Coerces an incoming risk-rating form value to a clamped 1-5 int, or null
// when the field is empty / not a number.
function riskRating(v: FormDataEntryValue | null): number | null {
  if (v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < 1 || i > 5) return null
  return i
}

export async function deleteHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentHazards).where(eq(hazidAssessmentHazards.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_hazard',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard',
  })
  revalidateAssessment(assessmentId)
}

export async function moveHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await reorderEntities(ctx, hazidAssessmentHazards, assessmentId, id, direction as 'up' | 'down')
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// PPE
// ------------------------------------------------------------------
export async function addPPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!assessmentId || !name) throw new Error('Missing fields')
  const description = nullable(formData.get('description'))
  const required = formData.get('required') === 'on' || formData.get('required') === 'true'
  await ctx.db(async (tx) => {
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentPPE.entityOrder) })
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentPPE).values({
      tenantId: ctx.tenantId,
      assessmentId,
      name,
      description,
      required,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: `Added PPE row "${name}"`,
  })
  revalidateAssessment(assessmentId)
}

export async function updatePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const name = String(formData.get('name') ?? '').trim() || undefined
  const description = nullable(formData.get('description'))
  const required = formData.get('required') === 'on' || formData.get('required') === 'true'
  const updates: Record<string, unknown> = { description, required }
  if (name) updates.name = name
  await ctx.db((tx) => tx.update(hazidAssessmentPPE).set(updates).where(eq(hazidAssessmentPPE.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_ppe',
    entityId: id,
    action: 'update',
    summary: 'Updated PPE row',
  })
  revalidateAssessment(assessmentId)
}

export async function answerPPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const answer = String(formData.get('answer') ?? '')
  if (!['yes', 'no', 'na'].includes(answer)) throw new Error('Bad answer')
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentPPE)
      .set({ answer: answer as 'yes' | 'no' | 'na' })
      .where(eq(hazidAssessmentPPE.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_ppe',
    entityId: id,
    action: 'update',
    summary: `Answered PPE row: ${answer}`,
  })
  revalidateAssessment(assessmentId)
}

export async function deletePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentPPE).where(eq(hazidAssessmentPPE.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_ppe',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PPE row',
  })
  revalidateAssessment(assessmentId)
}

export async function movePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await reorderEntities(ctx, hazidAssessmentPPE, assessmentId, id, direction as 'up' | 'down')
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Questions
// ------------------------------------------------------------------
export async function addQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const question = String(formData.get('question') ?? '').trim()
  if (!assessmentId || !question) throw new Error('Missing fields')
  const questionType = String(formData.get('questionType') ?? 'yes_no') as
    | 'yes_no'
    | 'text'
    | 'multi_select'
  const requiresYes = formData.get('requiresYes') === 'on' || formData.get('requiresYes') === 'true'
  const answersRaw = String(formData.get('answers') ?? '').trim()
  const answers = answersRaw
    ? answersRaw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
    : []
  await ctx.db(async (tx) => {
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentQuestions.entityOrder) })
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentQuestions).values({
      tenantId: ctx.tenantId,
      assessmentId,
      question,
      questionType,
      answers,
      requiresYes,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
  })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: 'Added question',
  })
  revalidateAssessment(assessmentId)
}

export async function answerQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const answer = nullable(formData.get('answer'))
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentQuestions)
      .set({ answer })
      .where(eq(hazidAssessmentQuestions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_question',
    entityId: id,
    action: 'update',
    summary: 'Answered question',
  })
  revalidateAssessment(assessmentId)
}

export async function updateQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const question = String(formData.get('question') ?? '').trim() || undefined
  const requiresYes = formData.get('requiresYes') === 'on' || formData.get('requiresYes') === 'true'
  const updates: Record<string, unknown> = { requiresYes }
  if (question) updates.question = question
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentQuestions)
      .set(updates)
      .where(eq(hazidAssessmentQuestions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_question',
    entityId: id,
    action: 'update',
    summary: 'Updated question',
  })
  revalidateAssessment(assessmentId)
}

export async function deleteQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentQuestions).where(eq(hazidAssessmentQuestions.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_question',
    entityId: id,
    action: 'delete',
    summary: 'Deleted question',
  })
  revalidateAssessment(assessmentId)
}

export async function moveQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await reorderEntities(ctx, hazidAssessmentQuestions, assessmentId, id, direction as 'up' | 'down')
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// CS atmospheric + entries
// ------------------------------------------------------------------
export async function addCSAtmospheric(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const sensorId = String(formData.get('atmosphericSensorId') ?? '').trim() || null
  const timeRaw = String(formData.get('time') ?? '')
  if (!assessmentId || !timeRaw) throw new Error('Missing time')
  const time = new Date(timeRaw)
  await ctx.db((tx) =>
    tx.insert(hazidAssessmentCSAtmospheric).values({
      tenantId: ctx.tenantId,
      assessmentId,
      atmosphericSensorId: sensorId,
      time,
      sensor1Reading: nullableNumeric(formData.get('sensor1Reading')),
      sensor2Reading: nullableNumeric(formData.get('sensor2Reading')),
      sensor3Reading: nullableNumeric(formData.get('sensor3Reading')),
      sensor4Reading: nullableNumeric(formData.get('sensor4Reading')),
      distance: nullable(formData.get('distance')),
      notes: nullable(formData.get('notes')),
    }),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: 'Added atmospheric reading',
  })
  revalidateAssessment(assessmentId)
}

export async function deleteCSAtmospheric(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentCSAtmospheric).where(eq(hazidAssessmentCSAtmospheric.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_cs_atmospheric',
    entityId: id,
    action: 'delete',
    summary: 'Deleted atmospheric reading',
  })
  revalidateAssessment(assessmentId)
}

export async function addCSEntry(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const personId = String(formData.get('personId') ?? '').trim() || null
  const externalName = String(formData.get('externalName') ?? '').trim() || null
  const timeInRaw = String(formData.get('timeIn') ?? '')
  if (!assessmentId) throw new Error('Missing assessmentId')
  const timeIn = timeInRaw ? new Date(timeInRaw) : new Date()
  await ctx.db((tx) =>
    tx.insert(hazidAssessmentCSEntries).values({
      tenantId: ctx.tenantId,
      assessmentId,
      personId,
      externalName,
      timeIn,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: 'Added confined-space entry',
  })
  revalidateAssessment(assessmentId)
}

export async function exitCSEntry(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentCSEntries)
      .set({ timeOut: new Date() })
      .where(eq(hazidAssessmentCSEntries.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_cs_entry',
    entityId: id,
    action: 'update',
    summary: 'Marked entry exit',
  })
  revalidateAssessment(assessmentId)
}

export async function deleteCSEntry(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentCSEntries).where(eq(hazidAssessmentCSEntries.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_cs_entry',
    entityId: id,
    action: 'delete',
    summary: 'Deleted confined-space entry',
  })
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Signatures
// ------------------------------------------------------------------
export async function addSignature(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const signatureType = String(formData.get('signatureType') ?? 'internal') as
    | 'internal'
    | 'external'
  const personId = String(formData.get('personId') ?? '').trim() || null
  const externalName = String(formData.get('externalName') ?? '').trim() || null
  const signatureDataUrl = String(formData.get('signatureDataUrl') ?? '').trim() || null
  const csEntrant = formData.get('csEntrant') === 'on' || formData.get('csEntrant') === 'true'
  const csAttendant = formData.get('csAttendant') === 'on' || formData.get('csAttendant') === 'true'
  const csRescue = formData.get('csRescue') === 'on' || formData.get('csRescue') === 'true'
  if (!assessmentId) throw new Error('Missing assessmentId')
  if (signatureType === 'internal' && !personId) throw new Error('Internal signer requires a person')
  if (signatureType === 'external' && !externalName) throw new Error('External signer requires a name')

  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidAssessmentSignatures)
      .values({
        tenantId: ctx.tenantId,
        assessmentId,
        signatureType,
        personId,
        externalName,
        signatureDataUrl,
        csEntrant,
        csAttendant,
        csRescue,
        signedAt: signatureDataUrl ? new Date() : null,
      })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_signature',
    entityId: row?.id,
    action: 'sign',
    summary: `Added ${signatureType} signature`,
  })
  revalidateAssessment(assessmentId)
}

export async function updateSignature(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const personId = formData.has('personId')
    ? String(formData.get('personId') ?? '').trim() || null
    : undefined
  const externalName = formData.has('externalName')
    ? String(formData.get('externalName') ?? '').trim() || null
    : undefined
  const signatureDataUrl = formData.has('signatureDataUrl')
    ? String(formData.get('signatureDataUrl') ?? '').trim() || null
    : undefined
  const csEntrant = formData.has('csEntrant')
    ? formData.get('csEntrant') === 'on' || formData.get('csEntrant') === 'true'
    : undefined
  const csAttendant = formData.has('csAttendant')
    ? formData.get('csAttendant') === 'on' || formData.get('csAttendant') === 'true'
    : undefined
  const csRescue = formData.has('csRescue')
    ? formData.get('csRescue') === 'on' || formData.get('csRescue') === 'true'
    : undefined

  const updates: Record<string, unknown> = {}
  if (personId !== undefined) updates.personId = personId
  if (externalName !== undefined) updates.externalName = externalName
  if (signatureDataUrl !== undefined) {
    updates.signatureDataUrl = signatureDataUrl
    updates.signedAt = signatureDataUrl ? new Date() : null
  }
  if (csEntrant !== undefined) updates.csEntrant = csEntrant
  if (csAttendant !== undefined) updates.csAttendant = csAttendant
  if (csRescue !== undefined) updates.csRescue = csRescue

  await ctx.db((tx) => tx.update(hazidAssessmentSignatures).set(updates).where(eq(hazidAssessmentSignatures.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_signature',
    entityId: id,
    action: 'update',
    summary: 'Updated signature',
  })
  revalidateAssessment(assessmentId)
}

export async function deleteSignature(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentSignatures).where(eq(hazidAssessmentSignatures.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_signature',
    entityId: id,
    action: 'delete',
    summary: 'Deleted signature',
  })
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Photos
// ------------------------------------------------------------------
export async function attachPhotos(formData: FormData) {
  const ctx = await ctxWithTenant()
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const ids = String(formData.get('attachmentIds') ?? '').split(',').filter(Boolean)
  if (!assessmentId || ids.length === 0) return
  await ctx.db((tx) =>
    tx.insert(hazidAssessmentPhotos).values(
      ids.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        assessmentId,
        attachmentId,
      })),
    ),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'}`,
  })
  revalidateAssessment(assessmentId)
}

export async function deletePhoto(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentPhotos).where(eq(hazidAssessmentPhotos.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'update',
    summary: 'Removed photo',
  })
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Signed report bundle builder
// ------------------------------------------------------------------
//
// The builder UI submits this action with:
//   * title (required)
//   * description
//   * assessmentIds[] (comma separated, required, >= 1)
//   * recipientEmails (any whitespace/comma separated list)
//   * builtAt timestamp (now)
//
// We insert a pending hazid_signed_reports row, audit-log the build, then
// enqueue the wave-7 'hazid_signed_report' PDF job. The worker concatenates
// per-assessment HTML + a cover page into a single bundled PDF, links it to
// the row, and (if recipientEmails is non-empty) emails a signed link.
//
// On success we redirect to the bundle's detail page so the user can watch
// the render flip pending → rendering → completed.
export async function buildSignedReport(formData: FormData) {
  const ctx = await ctxWithTenant()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) throw new Error('Title is required')
  const description = nullable(formData.get('description'))
  const assessmentIds = String(formData.get('assessmentIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (assessmentIds.length === 0) throw new Error('Pick at least one assessment')
  const recipientEmails = String(formData.get('recipientEmails') ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))

  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidSignedReports)
      .values({
        tenantId: ctx.tenantId,
        title,
        description,
        assessmentIds,
        recipientEmails,
        status: 'pending',
        builtByTenantUserId: ctx.membership?.id ?? null,
        builtAt: new Date(),
      })
      .returning(),
  )
  if (!row) throw new Error('Failed to insert signed-report row')

  await recordAudit(ctx, {
    entityType: 'hazid_signed_report',
    entityId: row.id,
    action: 'create',
    summary: `Built signed-report bundle "${title}" (${assessmentIds.length} assessments)`,
    after: {
      title,
      count: assessmentIds.length,
      recipientCount: recipientEmails.length,
    },
  })

  // Enqueue the bundler. The worker handles status transitions + email send.
  await enqueuePdf({
    kind: 'hazid_signed_report',
    tenantId: ctx.tenantId,
    reportId: row.id,
  })

  revalidatePath('/hazid/reports/signed')
  revalidatePath(`/hazid/reports/signed/${row.id}`)
  // Send the user to the detail page so they can watch progress.
  redirect(`/hazid/reports/signed/${row.id}` as any)
}

// Legacy fallback — kept for parity with the old listing page that surfaces
// "Mark ready" for pre-worker rows. New writes flow through the worker, but
// admins occasionally need to flip a stale 'pending' row by hand.
export async function markSignedReportReady(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx
      .update(hazidSignedReports)
      .set({ status: 'ready', builtAt: new Date() })
      .where(eq(hazidSignedReports.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_signed_report',
    entityId: id,
    action: 'update',
    summary: 'Marked bundle as ready (manual override)',
  })
  revalidatePath('/hazid/reports/signed')
}

// Re-enqueue the bundler for an existing report. Used by the detail page when
// a build failed and the user wants to retry, OR when admins want to refresh
// a completed bundle (e.g. an assessment was updated after the bundle was
// built). Flips the row back to 'pending' so the worker picks it up.
export async function retrySignedReport(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing id')

  await ctx.db((tx) =>
    tx
      .update(hazidSignedReports)
      .set({ status: 'pending', errorMessage: null })
      .where(eq(hazidSignedReports.id, id)),
  )
  await enqueuePdf({
    kind: 'hazid_signed_report',
    tenantId: ctx.tenantId,
    reportId: id,
  })
  await recordAudit(ctx, {
    entityType: 'hazid_signed_report',
    entityId: id,
    action: 'update',
    summary: 'Re-enqueued signed-report render',
  })
  revalidatePath(`/hazid/reports/signed/${id}`)
  revalidatePath('/hazid/reports/signed')
}

// Re-send the bundle email to the same recipients (or an override list). Used
// by the detail page's "Re-send email" button after a bundle has completed.
// Composes the same html/text body the worker uses and enqueues via the email
// queue so the email_log fan-out still applies.
export async function resendSignedReportEmail(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing id')

  const overrideRaw = String(formData.get('recipients') ?? '').trim()
  const overrideRecipients = overrideRaw
    ? overrideRaw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.includes('@'))
    : []

  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ report: hazidSignedReports, attachment: attachments })
      .from(hazidSignedReports)
      .leftJoin(attachments, eq(attachments.id, hazidSignedReports.pdfAttachmentId))
      .where(eq(hazidSignedReports.id, id))
      .limit(1)
    return row ?? null
  })
  if (!result || !result.report) throw new Error('Signed-report not found')
  if (result.report.status !== 'completed' || !result.attachment) {
    throw new Error('Bundle is not completed — cannot re-send email')
  }

  const recipients =
    overrideRecipients.length > 0 ? overrideRecipients : result.report.recipientEmails
  if (recipients.length === 0) throw new Error('No recipients on file')

  const signedUrl = await presignGet({
    key: result.attachment.r2Key,
    expiresInSeconds: 7 * 24 * 3600,
  })
  const assessmentCount = result.report.assessmentIds.length

  const subject = `Signed-report bundle: ${result.report.title}`
  const text = [
    `A signed-report bundle has been re-sent for your review.`,
    ``,
    `Title: ${result.report.title}`,
    `Assessments included: ${assessmentCount}`,
    result.report.description ? `\nDescription:\n${result.report.description}` : '',
    ``,
    `Download the PDF (link valid for 7 days):`,
    signedUrl,
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(result.report.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        Signed-report bundle ·
        ${assessmentCount} assessment${assessmentCount === 1 ? '' : 's'}
      </div>
      ${
        result.report.description
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;white-space:pre-wrap;">${escapeHtml(result.report.description)}</div>`
          : ''
      }
      <p style="font-size:13px;">A signed-report bundle has been re-sent for your review.</p>
      <p style="font-size:13px;margin-top:18px;">
        <a href="${escapeHtml(signedUrl)}"
           style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Download PDF
        </a>
      </p>
      <p style="font-size:11px;color:#94a3b8;margin-top:18px;">
        This link is valid for 7 days. After it expires, ask the bundle owner to re-send.
      </p>
    </div>
  `

  await enqueueEmail({
    to: recipients,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'hazid_signed_report',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'hazid_signed_report',
    entityId: id,
    action: 'export',
    summary: `Re-sent signed-report bundle email to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
    after: { recipients, recipientCount: recipients.length },
  })
  revalidatePath(`/hazid/reports/signed/${id}`)
}

export async function deleteSignedReport(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(hazidSignedReports).where(eq(hazidSignedReports.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_signed_report',
    entityId: id,
    action: 'delete',
    summary: 'Deleted bundle',
  })
  revalidatePath('/hazid/reports/signed')
}

// Tiny html-escape helper used by the re-send email action. Mirrors the
// escapeHtml used by the worker.
function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ------------------------------------------------------------------
// Library CRUD — Hazards / Hazard types / Hazard sets / Tasks / Types
// ------------------------------------------------------------------

export async function createHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const color = String(formData.get('color') ?? '#64748b').trim() || '#64748b'
  const iconKey = nullable(formData.get('iconKey'))
  const description = nullable(formData.get('description'))
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazardTypes)
      .values({ tenantId: ctx.tenantId, name, color, iconKey, description })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard type "${name}"`,
  })
  revalidatePath('/hazid/hazards/types')
}

export async function updateHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    color: String(formData.get('color') ?? '').trim() || undefined,
    iconKey: nullable(formData.get('iconKey')),
    description: nullable(formData.get('description')),
  }
  await ctx.db((tx) => tx.update(hazidHazardTypes).set(updates).where(eq(hazidHazardTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard type',
  })
  revalidatePath('/hazid/hazards/types')
}

export async function deleteHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(hazidHazardTypes).where(eq(hazidHazardTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard type',
  })
  revalidatePath('/hazid/hazards/types')
}

export async function createHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const hazardTypeId = nullable(formData.get('hazardTypeId'))
  const description = nullable(formData.get('description'))
  const standardControls = nullable(formData.get('standardControls'))
  const risks = nullable(formData.get('risks'))
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazards)
      .values({ tenantId: ctx.tenantId, name, hazardTypeId, description, standardControls, risks })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard "${name}"`,
  })
  revalidatePath('/hazid/hazards')
}

export async function updateHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    hazardTypeId: nullable(formData.get('hazardTypeId')),
    description: nullable(formData.get('description')),
    standardControls: nullable(formData.get('standardControls')),
    risks: nullable(formData.get('risks')),
  }
  await ctx.db((tx) => tx.update(hazidHazards).set(updates).where(eq(hazidHazards.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard',
  })
  revalidatePath('/hazid/hazards')
  revalidatePath(`/hazid/hazards/${id}`)
}

export async function deleteHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(hazidHazards).set({ deletedAt: new Date() }).where(eq(hazidHazards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard',
  })
  revalidatePath('/hazid/hazards')
}

export async function createHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = nullable(formData.get('description'))
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazardSets)
      .values({ tenantId: ctx.tenantId, name, description, hazardIds })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard set "${name}"`,
  })
  revalidatePath('/hazid/hazards/sets')
}

export async function updateHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    description: nullable(formData.get('description')),
    hazardIds,
  }
  await ctx.db((tx) => tx.update(hazidHazardSets).set(updates).where(eq(hazidHazardSets.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard set',
  })
  revalidatePath('/hazid/hazards/sets')
}

export async function deleteHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(hazidHazardSets).where(eq(hazidHazardSets.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard set',
  })
  revalidatePath('/hazid/hazards/sets')
}

export async function createTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = nullable(formData.get('description'))
  const controls = nullable(formData.get('controls'))
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidTasks)
      .values({ tenantId: ctx.tenantId, name, description, controls, hazardIds })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: row?.id,
    action: 'create',
    summary: `Created task "${name}"`,
  })
  revalidatePath('/hazid/tasks')
}

export async function updateTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    description: nullable(formData.get('description')),
    controls: nullable(formData.get('controls')),
    hazardIds,
  }
  await ctx.db((tx) => tx.update(hazidTasks).set(updates).where(eq(hazidTasks.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: id,
    action: 'update',
    summary: 'Updated task',
  })
  revalidatePath('/hazid/tasks')
  revalidatePath(`/hazid/tasks/${id}`)
}

export async function deleteTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(hazidTasks).set({ deletedAt: new Date() }).where(eq(hazidTasks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: id,
    action: 'delete',
    summary: 'Deleted task',
  })
  revalidatePath('/hazid/tasks')
}

export async function createAssessmentType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const style = String(formData.get('style') ?? 'task_based') as 'task_based' | 'hazard_based'
  const flag = (k: string) => formData.get(k) === 'on' || formData.get(k) === 'true'
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidAssessmentTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: nullable(formData.get('description')),
        style,
        hasTasks: flag('hasTasks'),
        hasHazards: flag('hasHazards'),
        hasPPE: flag('hasPPE'),
        hasQuestions: flag('hasQuestions'),
        hasWAH: flag('hasWAH'),
        hasCS: flag('hasCS'),
        hasArcFlash: flag('hasArcFlash'),
        defaultHazardSetId: nullable(formData.get('defaultHazardSetId')),
      })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: row?.id,
    action: 'create',
    summary: `Created assessment type "${name}"`,
  })
  revalidatePath('/hazid/types')
}

export async function updateAssessmentType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const flag = (k: string) => formData.get(k) === 'on' || formData.get(k) === 'true'
  const updates: Record<string, unknown> = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    description: nullable(formData.get('description')),
    style: String(formData.get('style') ?? '').trim() || undefined,
    hasTasks: flag('hasTasks'),
    hasHazards: flag('hasHazards'),
    hasPPE: flag('hasPPE'),
    hasQuestions: flag('hasQuestions'),
    hasWAH: flag('hasWAH'),
    hasCS: flag('hasCS'),
    hasArcFlash: flag('hasArcFlash'),
    defaultHazardSetId: nullable(formData.get('defaultHazardSetId')),
  }
  await ctx.db((tx) => tx.update(hazidAssessmentTypes).set(updates).where(eq(hazidAssessmentTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: id,
    action: 'update',
    summary: 'Updated assessment type',
  })
  revalidatePath('/hazid/types')
  revalidatePath(`/hazid/types/${id}`)
}

export async function deleteAssessmentType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(hazidAssessmentTypes).set({ deletedAt: new Date() }).where(eq(hazidAssessmentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted assessment type',
  })
  revalidatePath('/hazid/types')
}

// Type-default PPE rows
export async function addTypePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const typeId = String(formData.get('typeId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!typeId || !name) throw new Error('Missing fields')
  await ctx.db(async (tx) => {
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentTypePPE.entityOrder) })
      .from(hazidAssessmentTypePPE)
      .where(eq(hazidAssessmentTypePPE.typeId, typeId))
    await tx.insert(hazidAssessmentTypePPE).values({
      tenantId: ctx.tenantId,
      typeId,
      name,
      description: nullable(formData.get('description')),
      required: formData.get('required') === 'on' || formData.get('required') === 'true',
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
  })
  revalidatePath(`/hazid/types/${typeId}`)
}

export async function deleteTypePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  await ctx.db((tx) => tx.delete(hazidAssessmentTypePPE).where(eq(hazidAssessmentTypePPE.id, id)))
  revalidatePath(`/hazid/types/${typeId}`)
}

// Type-default questions
export async function addTypeQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const typeId = String(formData.get('typeId') ?? '')
  const question = String(formData.get('question') ?? '').trim()
  if (!typeId || !question) throw new Error('Missing fields')
  const questionType = String(formData.get('questionType') ?? 'yes_no') as
    | 'yes_no'
    | 'text'
    | 'multi_select'
  const requiresYes = formData.get('requiresYes') === 'on' || formData.get('requiresYes') === 'true'
  const answersRaw = String(formData.get('answers') ?? '').trim()
  const answers = answersRaw
    ? answersRaw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
    : []
  await ctx.db(async (tx) => {
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentTypeQuestions.entityOrder) })
      .from(hazidAssessmentTypeQuestions)
      .where(eq(hazidAssessmentTypeQuestions.typeId, typeId))
    await tx.insert(hazidAssessmentTypeQuestions).values({
      tenantId: ctx.tenantId,
      typeId,
      question,
      questionType,
      answers,
      requiresYes,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
  })
  revalidatePath(`/hazid/types/${typeId}`)
}

export async function deleteTypeQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  await ctx.db((tx) =>
    tx.delete(hazidAssessmentTypeQuestions).where(eq(hazidAssessmentTypeQuestions.id, id)),
  )
  revalidatePath(`/hazid/types/${typeId}`)
}

// ------------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------------
function nullable(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function nullableNumeric(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  if (Number.isNaN(Number(s))) return null
  // numeric() columns expect string in Drizzle
  return s
}

// Generic reorder: untyped pass-through to avoid Drizzle's structural-table
// inference complaining when the same helper is used for different tables.
async function reorderEntities(
  ctx: HazidCtx,
  table: any,
  assessmentId: string,
  rowId: string,
  direction: 'up' | 'down',
) {
  await ctx.db(async (tx) => {
    const t = table as any
    const rows = (await tx
      .select({ id: t.id, entityOrder: t.entityOrder })
      .from(t)
      .where(eq(t.assessmentId, assessmentId))
      .orderBy(asc(t.entityOrder))) as { id: string; entityOrder: number }[]
    const idx = rows.findIndex((r) => r.id === rowId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rows.length) return
    const a = rows[idx]
    const b = rows[swapIdx]
    if (!a || !b) return
    await tx.update(t).set({ entityOrder: b.entityOrder }).where(eq(t.id, a.id))
    await tx.update(t).set({ entityOrder: a.entityOrder }).where(eq(t.id, b.id))
  })
}
