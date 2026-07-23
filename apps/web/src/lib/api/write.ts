// Write handlers for the public API. Writes do NOT go through the read registry
// (that includes views and only a reporting subset of columns) — each writable
// entity has a hand-written, validated create that mirrors the real server
// action: zod-validated body, tenant-scoped FK checks, insert, audit. Adding an
// entity = add a handler here; OpenAPI is derived from this map, so docs and
// runtime permissions stay in sync.

import { randomBytes, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import {
  correctiveActionSeverity,
  correctiveActionStatus,
  correctiveActionSource,
  correctiveActions,
  departments,
  documentCategories,
  documents,
  documentTypes,
  equipmentCategories,
  equipmentItems,
  equipmentLocationHistory,
  equipmentStatus,
  equipmentTypes,
  incidents,
  incidentSeverity,
  incidentStatus,
  incidentType,
  inspectionRecordStatus,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  people,
  ppeItemStatus,
  ppeItems,
  ppeTypes,
  tenantUsers,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
  trainingRecordSource,
} from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import {
  materializeEvidenceTargetObligations,
  materializeEvidenceTargetsObligations,
} from '@beaconhs/compliance'
import { correctiveActionCreatedEvent, incidentCreatedEvent } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import {
  documentKeyFromTitle,
  isDocumentKeyConflict,
  parseDocumentKey,
} from '@/lib/document-key-policy'
import { DOCUMENT_METADATA_LIMITS } from '@/lib/document-metadata-limits'
import { softDeleteDocumentsInTransaction } from '@/lib/document-deletion'
import {
  InspectionTransitionError,
  assertInspectionStatusTransitionInTx,
  inspectionStatusMilestonePatch,
  lockInspectionRecordForMutation,
  materialiseCriteriaForRecordInTx,
  nextInspectionReferenceInTx,
} from '@/app/(app)/inspections/_lib'
import { nextReference } from '@/lib/reference'
import { openEquipmentCheckoutItemIds, refreshEquipmentAvailability } from '@/lib/equipment-custody'
import {
  materializeEquipmentTypeEvidence,
  materializePpeTypeEvidence,
} from '@/lib/compliance-type-evidence'
import { isUuid } from '@/lib/list-params'
import { ApiError } from './errors'

type Json = Record<string, unknown>
type WriteResult = { id: string; [k: string]: unknown }
type WriteHandler = (ctx: RequestContext, body: unknown) => Promise<WriteResult>
type PatchHandler = (ctx: RequestContext, id: string, body: unknown) => Promise<WriteResult>
type DeleteHandler = (ctx: RequestContext, id: string) => Promise<WriteResult>
type TenantTx = Parameters<Parameters<RequestContext['db']>[0]>[0]
type WriteRegistration = {
  permission: string
  handler: WriteHandler
  bodySchema: Json
  update?: {
    permission: string
    handler: PatchHandler
    bodySchema: Json
  }
  delete?: {
    permission: string
    handler: DeleteHandler
  }
}

const uuid = z.string().refine(isUuid, { message: 'Expected a uuid' })
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected a date (YYYY-MM-DD)' })
const metadata = z.record(z.string(), z.unknown()).default({})

function validationError(error: z.ZodError): ApiError {
  return ApiError.invalid(
    'Validation failed',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  )
}

function stripEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function optionalDate(value: string | null | undefined): string | null {
  return value ?? null
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function assertPatchNotEmpty(patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) {
    throw ApiError.invalid('At least one editable field is required')
  }
}

function optionalObjectSchema(schema: Json): Json {
  return {
    type: 'object',
    properties: (schema.properties as Json | undefined) ?? {},
    additionalProperties: false,
  }
}

function safeTenantUserId(ctx: RequestContext): string | null {
  return ctx.membership?.id ?? null
}

async function ensureSite(tx: TenantTx, id: string | null | undefined): Promise<void> {
  if (!id) return
  const [site] = await tx
    .select({ id: orgUnits.id, level: orgUnits.level })
    .from(orgUnits)
    .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
    .limit(1)
  if (!site) throw ApiError.invalid(`No org unit with id ${id} in this tenant`)
  if (site.level !== 'site') throw ApiError.invalid(`Org unit ${id} is not a site`)
}

async function ensureOrgUnit(
  tx: TenantTx,
  id: string | null | undefined,
  label = 'org unit',
): Promise<void> {
  if (!id) return
  const [unit] = await tx
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
    .limit(1)
  if (!unit) throw ApiError.invalid(`No ${label} with id ${id} in this tenant`)
}

async function ensurePerson(
  tx: TenantTx,
  id: string | null | undefined,
  label = 'person',
): Promise<void> {
  if (!id) return
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1)
  if (!person) throw ApiError.invalid(`No ${label} with id ${id} in this tenant`)
}

async function ensurePeople(tx: TenantTx, ids: string[], label = 'person'): Promise<void> {
  for (const id of ids) await ensurePerson(tx, id, label)
}

async function ensureTenantUser(
  tx: TenantTx,
  id: string | null | undefined,
  label = 'tenant user',
): Promise<void> {
  if (!id) return
  const [member] = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(eq(tenantUsers.id, id))
    .limit(1)
  if (!member) throw ApiError.invalid(`No ${label} with id ${id} in this tenant`)
}

// --- incidents ---------------------------------------------------------------

const incidentCreate = z.object({
  type: z.enum(incidentType.enumValues).default('other'),
  severity: z.enum(incidentSeverity.enumValues).default('no_injury'),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(5000).nullish(),
  occurredAt: z.coerce.date(),
  siteOrgUnitId: uuid.nullish(),
  location: z.string().max(500).nullish(),
  weather: z.string().max(200).nullish(),
  departmentId: uuid.nullish(),
  supervisorPersonId: uuid.nullish(),
  foremanText: z.string().max(200).nullish(),
  externalPeopleInvolved: z.string().max(1000).nullish(),
  witnesses: z.string().max(1000).nullish(),
  eventsLeadingUp: z.string().max(5000).nullish(),
  immediateActionTaken: z.string().max(5000).nullish(),
  ppeWorn: z.string().max(1000).nullish(),
  criticalInjury: z.boolean().default(false),
  ministryOfLabourNotified: z.boolean().default(false),
  emsCalled: z.boolean().default(false),
  firstAidGiven: z.boolean().default(false),
  firstAidProvider: z.string().max(200).nullish(),
  medicalAttentionReceived: z.boolean().default(false),
  hospitalName: z.string().max(300).nullish(),
  actualSeverity: z.number().int().min(1).max(5).nullish(),
  potentialSeverity: z.number().int().min(1).max(5).nullish(),
  severityRating: z.number().int().min(1).max(5).nullish(),
})

async function createIncident(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = incidentCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    await ensureSite(tx, b.siteOrgUnitId)
    await ensurePerson(tx, b.supervisorPersonId, 'supervisor')
    if (b.departmentId) {
      const [department] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, b.departmentId))
        .limit(1)
      if (!department) {
        throw ApiError.invalid(`No department with id ${b.departmentId} in this tenant`)
      }
    }

    const reference = await nextReference(tx, ctx.tenantId, 'incident')

    const [created] = await tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type: b.type,
        severity: b.severity,
        status: 'reported',
        title: b.title,
        description: stripEmpty(b.description),
        occurredAt: b.occurredAt,
        siteOrgUnitId: b.siteOrgUnitId ?? null,
        location: stripEmpty(b.location),
        weather: stripEmpty(b.weather),
        departmentId: b.departmentId ?? null,
        reportedByTenantUserId: safeTenantUserId(ctx),
        supervisorPersonId: b.supervisorPersonId ?? null,
        foremanText: stripEmpty(b.foremanText),
        externalPeopleInvolved: stripEmpty(b.externalPeopleInvolved),
        witnesses: stripEmpty(b.witnesses),
        eventsLeadingUp: stripEmpty(b.eventsLeadingUp),
        immediateActionTaken: stripEmpty(b.immediateActionTaken),
        ppeWorn: stripEmpty(b.ppeWorn),
        criticalInjury: b.criticalInjury,
        ministryOfLabourNotified: b.ministryOfLabourNotified,
        emsCalled: b.emsCalled,
        firstAidGiven: b.firstAidGiven,
        firstAidProvider: stripEmpty(b.firstAidProvider),
        medicalAttentionReceived: b.medicalAttentionReceived,
        hospitalName: stripEmpty(b.hospitalName),
        actualSeverity: b.actualSeverity ?? null,
        potentialSeverity: b.potentialSeverity ?? null,
        severityRating: b.severityRating ?? null,
      })
      .returning()
    if (created) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'incident.created',
        subjectId: created.id,
        dedupKey: `incident.created:${created.id}`,
        payload: {
          notification: { kind: 'incident_reported', incidentId: created.id },
          integration: incidentCreatedEvent(ctx.tenantId, {
            id: created.id,
            reference: created.reference,
            type: created.type,
            severity: created.severity,
            status: created.status,
            title: created.title,
            description: created.description,
            occurredAt: created.occurredAt,
            location: created.location,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: created.id,
            moduleKey: 'incidents',
            event: 'on_create',
          }),
        },
      })
    }
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create incident')
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: row.id,
    action: 'create',
    summary: `Reported ${row.reference}: ${row.title}`,
    after: {
      reference: row.reference,
      type: row.type,
      severity: row.severity,
      occurredAt: row.occurredAt,
      siteOrgUnitId: row.siteOrgUnitId,
    },
  })
  revalidatePath('/incidents')

  return incidentResult(row)
}

function incidentResult(row: typeof incidents.$inferSelect): WriteResult {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    severity: row.severity,
    status: row.status,
    type: row.type,
    occurred_at: row.occurredAt.toISOString(),
    site_org_unit_id: row.siteOrgUnitId,
    department_id: row.departmentId,
    actual_severity: row.actualSeverity,
    potential_severity: row.potentialSeverity,
  }
}

const patchableIncidentStatuses = incidentStatus.enumValues.filter((status) => status !== 'closed')
const incidentPatch = incidentCreate.partial().extend({
  status: z.enum(['reported', 'under_investigation', 'pending_review', 'reopened']).optional(),
})

async function updateIncident(ctx: RequestContext, id: string, raw: unknown): Promise<WriteResult> {
  const parsed = incidentPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx.select().from(incidents).where(eq(incidents.id, id)).limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No incidents with id ${id}`)
    if (before.locked) throw ApiError.invalid('Incident is locked and cannot be updated')

    await ensureSite(tx, b.siteOrgUnitId)
    await ensurePerson(tx, b.supervisorPersonId, 'supervisor')
    if (b.departmentId) {
      const [department] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, b.departmentId))
        .limit(1)
      if (!department) {
        throw ApiError.invalid(`No department with id ${b.departmentId} in this tenant`)
      }
    }

    const patch: Partial<typeof incidents.$inferInsert> = {}
    if (hasOwn(b, 'type')) patch.type = b.type
    if (hasOwn(b, 'severity')) patch.severity = b.severity
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'title')) patch.title = b.title
    if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
    if (hasOwn(b, 'occurredAt')) patch.occurredAt = b.occurredAt
    if (hasOwn(b, 'siteOrgUnitId')) patch.siteOrgUnitId = b.siteOrgUnitId ?? null
    if (hasOwn(b, 'location')) patch.location = stripEmpty(b.location)
    if (hasOwn(b, 'weather')) patch.weather = stripEmpty(b.weather)
    if (hasOwn(b, 'departmentId')) patch.departmentId = b.departmentId ?? null
    if (hasOwn(b, 'supervisorPersonId')) patch.supervisorPersonId = b.supervisorPersonId ?? null
    if (hasOwn(b, 'foremanText')) patch.foremanText = stripEmpty(b.foremanText)
    if (hasOwn(b, 'externalPeopleInvolved')) {
      patch.externalPeopleInvolved = stripEmpty(b.externalPeopleInvolved)
    }
    if (hasOwn(b, 'witnesses')) patch.witnesses = stripEmpty(b.witnesses)
    if (hasOwn(b, 'eventsLeadingUp')) patch.eventsLeadingUp = stripEmpty(b.eventsLeadingUp)
    if (hasOwn(b, 'immediateActionTaken')) {
      patch.immediateActionTaken = stripEmpty(b.immediateActionTaken)
    }
    if (hasOwn(b, 'ppeWorn')) patch.ppeWorn = stripEmpty(b.ppeWorn)
    if (hasOwn(b, 'criticalInjury')) patch.criticalInjury = b.criticalInjury
    if (hasOwn(b, 'ministryOfLabourNotified')) {
      patch.ministryOfLabourNotified = b.ministryOfLabourNotified
    }
    if (hasOwn(b, 'emsCalled')) patch.emsCalled = b.emsCalled
    if (hasOwn(b, 'firstAidGiven')) patch.firstAidGiven = b.firstAidGiven
    if (hasOwn(b, 'firstAidProvider')) patch.firstAidProvider = stripEmpty(b.firstAidProvider)
    if (hasOwn(b, 'medicalAttentionReceived')) {
      patch.medicalAttentionReceived = b.medicalAttentionReceived
    }
    if (hasOwn(b, 'hospitalName')) patch.hospitalName = stripEmpty(b.hospitalName)
    if (hasOwn(b, 'actualSeverity')) patch.actualSeverity = b.actualSeverity ?? null
    if (hasOwn(b, 'potentialSeverity')) patch.potentialSeverity = b.potentialSeverity ?? null
    if (hasOwn(b, 'severityRating')) patch.severityRating = b.severityRating ?? null
    assertPatchNotEmpty(patch)

    const [updated] = await tx.update(incidents).set(patch).where(eq(incidents.id, id)).returning()
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update incident')
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: `Updated ${result.updated.reference}: ${result.updated.title}`,
    before: {
      title: result.before.title,
      status: result.before.status,
      severity: result.before.severity,
    },
    after: {
      title: result.updated.title,
      status: result.updated.status,
      severity: result.updated.severity,
    },
  })
  revalidatePath('/incidents')
  revalidatePath(`/incidents/${id}`)
  return incidentResult(result.updated)
}

async function deleteIncident(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx.select().from(incidents).where(eq(incidents.id, id)).limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No incidents with id ${id}`)
    if (before.locked) throw ApiError.invalid('Incident is locked and cannot be archived')
    const deletedAt = new Date()
    await tx.update(incidents).set({ deletedAt }).where(eq(incidents.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'delete',
    summary: `Archived ${result.before.reference}: ${result.before.title}`,
    before: {
      reference: result.before.reference,
      title: result.before.title,
      status: result.before.status,
    },
    after: { deletedAt: result.deletedAt },
  })
  revalidatePath('/incidents')
  revalidatePath(`/incidents/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const INCIDENT_BODY: Json = {
  type: 'object',
  required: ['title', 'occurredAt'],
  properties: {
    type: { type: 'string', enum: incidentType.enumValues, default: 'other' },
    severity: { type: 'string', enum: incidentSeverity.enumValues, default: 'no_injury' },
    title: { type: 'string', maxLength: 240 },
    description: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    siteOrgUnitId: { type: 'string', format: 'uuid' },
    location: { type: 'string' },
    weather: { type: 'string' },
    departmentId: { type: 'string', format: 'uuid' },
    supervisorPersonId: { type: 'string', format: 'uuid' },
    foremanText: { type: 'string' },
    externalPeopleInvolved: { type: 'string' },
    witnesses: { type: 'string' },
    eventsLeadingUp: { type: 'string' },
    immediateActionTaken: { type: 'string' },
    ppeWorn: { type: 'string' },
    criticalInjury: { type: 'boolean', default: false },
    ministryOfLabourNotified: { type: 'boolean', default: false },
    emsCalled: { type: 'boolean', default: false },
    firstAidGiven: { type: 'boolean', default: false },
    firstAidProvider: { type: 'string' },
    medicalAttentionReceived: { type: 'boolean', default: false },
    hospitalName: { type: 'string' },
    actualSeverity: { type: 'integer', minimum: 1, maximum: 5 },
    potentialSeverity: { type: 'integer', minimum: 1, maximum: 5 },
    severityRating: { type: 'integer', minimum: 1, maximum: 5 },
  },
}

const INCIDENT_PATCH_BODY: Json = {
  ...optionalObjectSchema(INCIDENT_BODY),
  properties: {
    ...(INCIDENT_BODY.properties as Json),
    status: {
      type: 'string',
      enum: patchableIncidentStatuses,
      description: 'Lifecycle close is intentionally not exposed through generic PATCH.',
    },
  },
}

// --- corrective_actions ------------------------------------------------------

const correctiveActionCreate = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(5000).nullish(),
  severity: z.enum(correctiveActionSeverity.enumValues).default('medium'),
  source: z.enum(correctiveActionSource.enumValues).default('other'),
  sourceEntityType: z.string().max(100).nullish(),
  sourceEntityId: uuid.nullish(),
  siteOrgUnitId: uuid.nullish(),
  assignedOn: isoDate.nullish(),
  dueOn: isoDate.nullish(),
  ownerTenantUserId: uuid.nullish(),
  verificationRequired: z.boolean().default(false),
  metadata,
})

async function createCorrectiveAction(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = correctiveActionCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data
  const assignedOn = b.assignedOn ?? new Date().toISOString().slice(0, 10)

  const row = await ctx.db(async (tx) => {
    await ensureSite(tx, b.siteOrgUnitId)
    await ensureTenantUser(tx, b.ownerTenantUserId, 'owner tenant user')
    if (b.sourceEntityType === 'incident' && b.sourceEntityId) {
      const [incident] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(eq(incidents.id, b.sourceEntityId))
        .limit(1)
      if (!incident) {
        throw ApiError.invalid(`No incident with id ${b.sourceEntityId} in this tenant`)
      }
    }

    const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')

    const [created] = await tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title: b.title,
        description: stripEmpty(b.description),
        severity: b.severity,
        status: 'open',
        source: b.source,
        sourceEntityType: stripEmpty(b.sourceEntityType),
        sourceEntityId: b.sourceEntityId ?? null,
        sourceFormResponseId:
          b.sourceEntityType === 'form_response' ? (b.sourceEntityId ?? null) : null,
        siteOrgUnitId: b.siteOrgUnitId ?? null,
        assignedOn,
        dueOn: optionalDate(b.dueOn),
        assignedByTenantUserId: safeTenantUserId(ctx),
        ownerTenantUserId: b.ownerTenantUserId ?? safeTenantUserId(ctx),
        verificationRequired: b.verificationRequired,
        metadata: b.metadata,
      })
      .returning()
    if (created) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.created',
        subjectId: created.id,
        dedupKey: `corrective_action.created:${created.id}`,
        payload: {
          notification: {
            kind: 'corrective_action_assigned',
            caId: created.id,
          },
          integration: correctiveActionCreatedEvent(ctx.tenantId, {
            id: created.id,
            reference: created.reference,
            title: created.title,
            status: created.status,
            severity: created.severity,
            source: created.source,
            dueOn: created.dueOn,
            assignedOn: created.assignedOn,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: created.id,
            moduleKey: 'corrective-actions',
            event: 'on_create',
          }),
        },
      })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'corrective_action',
        entityId: created.id,
        action: 'create',
        summary: `Created ${created.reference}: ${created.title}`,
        after: {
          reference: created.reference,
          severity: created.severity,
          source: created.source,
          dueOn: created.dueOn,
          siteOrgUnitId: created.siteOrgUnitId,
        },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'corrective_action',
        targetRef: {},
      })
    }
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create corrective action')
  revalidatePath('/corrective-actions')

  return correctiveActionResult(row)
}

function correctiveActionResult(row: typeof correctiveActions.$inferSelect): WriteResult {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    severity: row.severity,
    status: row.status,
    due_on: row.dueOn,
    assigned_on: row.assignedOn,
    source: row.source,
    site_org_unit_id: row.siteOrgUnitId,
  }
}

const patchableCorrectiveActionStatuses = correctiveActionStatus.enumValues.filter(
  (status) => status !== 'closed',
)
const correctiveActionPatch = correctiveActionCreate.partial().extend({
  status: z.enum(['open', 'in_progress', 'pending_verification', 'cancelled']).optional(),
  rootCause: z.string().max(5000).nullish(),
  actionTaken: z.string().max(5000).nullish(),
})

async function updateCorrectiveAction(
  ctx: RequestContext,
  id: string,
  raw: unknown,
): Promise<WriteResult> {
  const parsed = correctiveActionPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No corrective_actions with id ${id}`)
    }
    if (before.locked) throw ApiError.invalid('Corrective action is locked and cannot be updated')

    await ensureSite(tx, b.siteOrgUnitId)
    await ensureTenantUser(tx, b.ownerTenantUserId, 'owner tenant user')
    const sourceType =
      hasOwn(b, 'sourceEntityType') && typeof b.sourceEntityType !== 'undefined'
        ? stripEmpty(b.sourceEntityType)
        : before.sourceEntityType
    const sourceId =
      hasOwn(b, 'sourceEntityId') && typeof b.sourceEntityId !== 'undefined'
        ? (b.sourceEntityId ?? null)
        : before.sourceEntityId
    if (sourceType === 'incident' && sourceId) {
      const [incident] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(eq(incidents.id, sourceId))
        .limit(1)
      if (!incident) throw ApiError.invalid(`No incident with id ${sourceId} in this tenant`)
    }

    const patch: Partial<typeof correctiveActions.$inferInsert> = {}
    if (hasOwn(b, 'title')) patch.title = b.title
    if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
    if (hasOwn(b, 'severity')) patch.severity = b.severity
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'source')) patch.source = b.source
    if (hasOwn(b, 'sourceEntityType')) patch.sourceEntityType = sourceType
    if (hasOwn(b, 'sourceEntityId')) {
      patch.sourceEntityId = b.sourceEntityId ?? null
      patch.sourceFormResponseId =
        sourceType === 'form_response' ? (b.sourceEntityId ?? null) : null
    }
    if (hasOwn(b, 'siteOrgUnitId')) patch.siteOrgUnitId = b.siteOrgUnitId ?? null
    if (hasOwn(b, 'assignedOn')) patch.assignedOn = optionalDate(b.assignedOn)
    if (hasOwn(b, 'dueOn')) patch.dueOn = optionalDate(b.dueOn)
    if (hasOwn(b, 'ownerTenantUserId')) patch.ownerTenantUserId = b.ownerTenantUserId ?? null
    if (hasOwn(b, 'verificationRequired')) patch.verificationRequired = b.verificationRequired
    if (hasOwn(b, 'rootCause')) patch.rootCause = stripEmpty(b.rootCause)
    if (hasOwn(b, 'actionTaken')) patch.actionTaken = stripEmpty(b.actionTaken)
    if (hasOwn(b, 'metadata')) patch.metadata = b.metadata
    assertPatchNotEmpty(patch)

    const [updated] = await tx
      .update(correctiveActions)
      .set(patch)
      .where(eq(correctiveActions.id, id))
      .returning()
    if (updated && before.status !== updated.status) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'corrective-actions',
        event: 'status_change',
        toStatus: updated.status,
        occurrenceKey: randomUUID(),
      })
    }
    if (updated) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'corrective_action',
        entityId: id,
        action: 'update',
        summary: `Updated ${updated.reference}: ${updated.title}`,
        before: {
          title: before.title,
          status: before.status,
          severity: before.severity,
          ownerTenantUserId: before.ownerTenantUserId,
        },
        after: {
          title: updated.title,
          status: updated.status,
          severity: updated.severity,
          ownerTenantUserId: updated.ownerTenantUserId,
        },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'corrective_action',
        targetRef: {},
      })
    }
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update corrective action')
  revalidatePath('/corrective-actions')
  revalidatePath(`/corrective-actions/${id}`)
  return correctiveActionResult(result.updated)
}

async function deleteCorrectiveAction(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No corrective_actions with id ${id}`)
    }
    if (before.locked) throw ApiError.invalid('Corrective action is locked and cannot be archived')
    const deletedAt = new Date()
    await tx.update(correctiveActions).set({ deletedAt }).where(eq(correctiveActions.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: id,
      action: 'delete',
      summary: `Archived ${before.reference}: ${before.title}`,
      before: {
        reference: before.reference,
        title: before.title,
        status: before.status,
      },
      after: { deletedAt },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
    return { before, deletedAt }
  })
  revalidatePath('/corrective-actions')
  revalidatePath(`/corrective-actions/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const CORRECTIVE_ACTION_BODY: Json = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', maxLength: 240 },
    description: { type: 'string' },
    severity: { type: 'string', enum: correctiveActionSeverity.enumValues, default: 'medium' },
    source: { type: 'string', enum: correctiveActionSource.enumValues, default: 'other' },
    sourceEntityType: { type: 'string', description: 'Optional source type, e.g. incident.' },
    sourceEntityId: { type: 'string', format: 'uuid' },
    siteOrgUnitId: { type: 'string', format: 'uuid' },
    assignedOn: { type: 'string', format: 'date' },
    dueOn: { type: 'string', format: 'date' },
    ownerTenantUserId: { type: 'string', format: 'uuid' },
    verificationRequired: { type: 'boolean', default: false },
    metadata: { type: 'object', additionalProperties: true },
  },
}

const CORRECTIVE_ACTION_PATCH_BODY: Json = {
  ...optionalObjectSchema(CORRECTIVE_ACTION_BODY),
  properties: {
    ...(CORRECTIVE_ACTION_BODY.properties as Json),
    status: {
      type: 'string',
      enum: patchableCorrectiveActionStatuses,
      description: 'Lifecycle close is intentionally not exposed through generic PATCH.',
    },
    rootCause: { type: 'string' },
    actionTaken: { type: 'string' },
  },
}

// --- inspections -------------------------------------------------------------

const inspectionCreate = z.object({
  typeId: uuid,
  occurredAt: z.coerce.date().optional(),
  siteOrgUnitId: uuid.nullish(),
  locationOnSite: z.string().max(500).nullish(),
  inspectorTenantUserId: uuid.nullish(),
  supervisorTenantUserId: uuid.nullish(),
  foremanPersonIds: z.array(uuid).default([]),
  foremanText: z.string().max(500).nullish(),
  customerOrgUnitId: uuid.nullish(),
  customerContactPersonId: uuid.nullish(),
  customerContactName: z.string().max(240).nullish(),
  notes: z.string().max(5000).nullish(),
  metadata,
})

const inspectionPatch = inspectionCreate.partial().extend({
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(inspectionRecordStatus.enumValues).optional(),
})

async function ensureInspectionType(tx: TenantTx, typeId: string): Promise<void> {
  const [type] = await tx
    .select({ id: inspectionTypes.id })
    .from(inspectionTypes)
    .where(
      and(
        eq(inspectionTypes.id, typeId),
        eq(inspectionTypes.isPublished, true),
        isNull(inspectionTypes.deletedAt),
      ),
    )
    .limit(1)
  if (!type) throw ApiError.invalid(`No published inspection type with id ${typeId}`)
}

async function createInspection(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = inspectionCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data
  const occurredAt = b.occurredAt ?? new Date()

  const row = await ctx.db(async (tx) => {
    await ensureInspectionType(tx, b.typeId)
    await ensureSite(tx, b.siteOrgUnitId)
    await ensureTenantUser(tx, b.inspectorTenantUserId, 'inspector')
    await ensureTenantUser(tx, b.supervisorTenantUserId, 'supervisor')
    await ensurePeople(tx, b.foremanPersonIds, 'foreman')
    await ensureOrgUnit(tx, b.customerOrgUnitId, 'customer org unit')
    await ensurePerson(tx, b.customerContactPersonId, 'customer contact')

    const reference = await nextInspectionReferenceInTx(tx, ctx.tenantId, occurredAt)
    const [created] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        typeId: b.typeId,
        status: 'draft',
        occurredAt,
        siteOrgUnitId: b.siteOrgUnitId ?? null,
        locationOnSite: stripEmpty(b.locationOnSite),
        inspectorTenantUserId: b.inspectorTenantUserId ?? safeTenantUserId(ctx),
        supervisorTenantUserId: b.supervisorTenantUserId ?? null,
        foremanPersonIds: b.foremanPersonIds,
        foremanText: stripEmpty(b.foremanText),
        customerOrgUnitId: b.customerOrgUnitId ?? null,
        customerContactPersonId: b.customerContactPersonId ?? null,
        customerContactName: stripEmpty(b.customerContactName),
        notes: stripEmpty(b.notes),
        metadata: b.metadata,
      })
      .returning()
    if (!created) throw new ApiError(500, 'internal', 'Failed to create inspection record')
    const materialised = await materialiseCriteriaForRecordInTx(
      tx,
      ctx.tenantId,
      created.id,
      created.typeId,
    )
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: created.id,
      moduleKey: 'inspections',
      event: 'on_create',
      occurrenceKey: created.id,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: created.id,
      action: 'create',
      summary: `Started ${created.reference} — materialised ${materialised} criteria`,
      after: {
        reference: created.reference,
        typeId: created.typeId,
        occurredAt: created.occurredAt,
        siteOrgUnitId: created.siteOrgUnitId,
        locationOnSite: created.locationOnSite,
      },
    })
    return created
  })

  revalidatePath('/inspections/records')
  return inspectionResult(row)
}

function inspectionResult(row: typeof inspectionRecords.$inferSelect): WriteResult {
  return {
    id: row.id,
    reference: row.reference,
    type_id: row.typeId,
    status: row.status,
    occurred_at: row.occurredAt.toISOString(),
    site_org_unit_id: row.siteOrgUnitId,
    location_on_site: row.locationOnSite,
    inspector_tenant_user_id: row.inspectorTenantUserId,
    supervisor_tenant_user_id: row.supervisorTenantUserId,
    foreman_person_ids: row.foremanPersonIds,
    foreman_text: row.foremanText,
    customer_org_unit_id: row.customerOrgUnitId,
    customer_contact_person_id: row.customerContactPersonId,
    customer_contact_name: row.customerContactName,
    notes: row.notes,
    submitted_at: row.submittedAt?.toISOString() ?? null,
    closed_at: row.closedAt?.toISOString() ?? null,
    locked: row.locked,
  }
}

async function updateInspection(
  ctx: RequestContext,
  id: string,
  raw: unknown,
): Promise<WriteResult> {
  const parsed = inspectionPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const before = await lockInspectionRecordForMutation(tx, ctx.tenantId, id)
    if (!before) throw ApiError.notFound(`No inspections with id ${id}`)
    if (before.locked || before.status === 'closed') {
      throw ApiError.invalid('Inspection is closed or locked and cannot be updated')
    }

    if (b.typeId && b.typeId !== before.typeId) {
      throw ApiError.invalid('Inspection type cannot be changed after record creation')
    }
    await ensureSite(tx, b.siteOrgUnitId)
    await ensureTenantUser(tx, b.inspectorTenantUserId, 'inspector')
    await ensureTenantUser(tx, b.supervisorTenantUserId, 'supervisor')
    if (b.foremanPersonIds) await ensurePeople(tx, b.foremanPersonIds, 'foreman')
    await ensureOrgUnit(tx, b.customerOrgUnitId, 'customer org unit')
    await ensurePerson(tx, b.customerContactPersonId, 'customer contact')

    const patch: Partial<typeof inspectionRecords.$inferInsert> = {}
    if (hasOwn(b, 'occurredAt')) patch.occurredAt = b.occurredAt
    if (hasOwn(b, 'siteOrgUnitId')) patch.siteOrgUnitId = b.siteOrgUnitId ?? null
    if (hasOwn(b, 'locationOnSite')) patch.locationOnSite = stripEmpty(b.locationOnSite)
    if (hasOwn(b, 'inspectorTenantUserId')) {
      patch.inspectorTenantUserId = b.inspectorTenantUserId ?? null
    }
    if (hasOwn(b, 'supervisorTenantUserId')) {
      patch.supervisorTenantUserId = b.supervisorTenantUserId ?? null
    }
    if (hasOwn(b, 'foremanPersonIds')) patch.foremanPersonIds = b.foremanPersonIds ?? []
    if (hasOwn(b, 'foremanText')) patch.foremanText = stripEmpty(b.foremanText)
    if (hasOwn(b, 'customerOrgUnitId')) patch.customerOrgUnitId = b.customerOrgUnitId ?? null
    if (hasOwn(b, 'customerContactPersonId')) {
      patch.customerContactPersonId = b.customerContactPersonId ?? null
    }
    if (hasOwn(b, 'customerContactName')) {
      patch.customerContactName = stripEmpty(b.customerContactName)
    }
    if (hasOwn(b, 'notes')) patch.notes = stripEmpty(b.notes)
    if (hasOwn(b, 'metadata')) patch.metadata = b.metadata
    const requestedStatus = b.status
    if (requestedStatus !== undefined && requestedStatus !== before.status) {
      const prospective = { ...before, ...patch }
      try {
        await assertInspectionStatusTransitionInTx(tx, ctx.tenantId, prospective, requestedStatus)
      } catch (error) {
        if (error instanceof InspectionTransitionError) {
          throw ApiError.invalid(error.message, error.details)
        }
        throw error
      }
      Object.assign(
        patch,
        inspectionStatusMilestonePatch(
          prospective,
          requestedStatus,
          safeTenantUserId(ctx),
          new Date(),
        ),
      )
    } else if (requestedStatus !== undefined) {
      patch.status = requestedStatus
    }
    assertPatchNotEmpty(patch)

    const effectivePatch = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) => !isDeepStrictEqual(before[key as keyof typeof before], value),
      ),
    ) as Partial<typeof inspectionRecords.$inferInsert>
    if (Object.keys(effectivePatch).length === 0) {
      return { before, updated: before, changed: false }
    }

    const [updated] = await tx
      .update(inspectionRecords)
      .set(effectivePatch)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning()
    if (!updated) throw new ApiError(500, 'internal', 'Failed to update inspection record')
    const statusChanged = before.status !== updated.status
    if (statusChanged) {
      const occurrenceKey = randomUUID()
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'inspections',
        event: 'status_change',
        toStatus: updated.status,
        occurrenceKey,
      })
      const wasSubmitted = before.status === 'submitted'
      const isSubmitted = updated.status === 'submitted' || updated.status === 'closed'
      if (isSubmitted && !wasSubmitted) {
        await recordModuleFlowEvent(tx, ctx, {
          subjectId: id,
          moduleKey: 'inspections',
          event: 'on_submit',
          occurrenceKey,
        })
      }
    }
    if (
      statusChanged ||
      hasOwn(effectivePatch, 'occurredAt') ||
      hasOwn(effectivePatch, 'inspectorTenantUserId')
    ) {
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'inspection',
        targetRef: { inspectionTypeId: updated.typeId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'update',
      summary: `Updated ${updated.reference}`,
      before: {
        status: before.status,
        occurredAt: before.occurredAt,
        siteOrgUnitId: before.siteOrgUnitId,
      },
      after: {
        status: updated.status,
        occurredAt: updated.occurredAt,
        siteOrgUnitId: updated.siteOrgUnitId,
      },
    })
    return { before, updated, changed: true }
  })

  if (result.changed) {
    revalidatePath('/inspections/records')
    revalidatePath(`/inspections/records/${id}`)
  }
  return inspectionResult(result.updated)
}

async function deleteInspection(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const before = await lockInspectionRecordForMutation(tx, ctx.tenantId, id)
    if (!before) throw ApiError.notFound(`No inspections with id ${id}`)
    if (before.locked || before.status === 'closed') {
      throw ApiError.invalid('Inspection is closed or locked and cannot be archived')
    }
    const deletedAt = new Date()
    const [archived] = await tx
      .update(inspectionRecords)
      .set({ deletedAt })
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning({ id: inspectionRecords.id })
    if (!archived) throw new ApiError(500, 'internal', 'Failed to archive inspection record')
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'inspection',
      targetRef: { inspectionTypeId: before.typeId },
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'delete',
      summary: `Archived ${before.reference}`,
      before: {
        reference: before.reference,
        status: before.status,
        occurredAt: before.occurredAt,
      },
      after: { deletedAt },
    })
    return { before, deletedAt }
  })
  revalidatePath('/inspections/records')
  revalidatePath(`/inspections/records/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const INSPECTION_BODY: Json = {
  type: 'object',
  required: ['typeId'],
  properties: {
    typeId: {
      type: 'string',
      format: 'uuid',
      description: 'Published inspection type to materialize criteria from.',
    },
    occurredAt: { type: 'string', format: 'date-time' },
    siteOrgUnitId: { type: 'string', format: 'uuid' },
    locationOnSite: {
      type: 'string',
      description: 'Specific place on the selected location where the inspection occurred.',
    },
    inspectorTenantUserId: { type: 'string', format: 'uuid' },
    supervisorTenantUserId: { type: 'string', format: 'uuid' },
    foremanPersonIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    foremanText: { type: 'string' },
    customerOrgUnitId: { type: 'string', format: 'uuid' },
    customerContactPersonId: { type: 'string', format: 'uuid' },
    customerContactName: { type: 'string' },
    notes: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true },
  },
}

const INSPECTION_PATCH_BODY: Json = {
  ...optionalObjectSchema(INSPECTION_BODY),
  properties: {
    ...(INSPECTION_BODY.properties as Json),
    status: {
      type: 'string',
      enum: inspectionRecordStatus.enumValues,
      description:
        'Submitting or closing requires complete criteria. Closing also enforces the inspection type’s required customer signature and foreman.',
    },
  },
}

// --- documents ---------------------------------------------------------------

const documentCreate = z.object({
  title: z.string().trim().min(1).max(DOCUMENT_METADATA_LIMITS.title),
  key: z.string().trim().max(DOCUMENT_METADATA_LIMITS.key).nullish(),
  description: z.string().max(DOCUMENT_METADATA_LIMITS.description).nullish(),
  typeId: uuid.nullish(),
  categoryId: uuid.nullish(),
  ownerTenantUserId: uuid.nullish(),
  reviewFrequencyMonths: z
    .number()
    .int()
    .positive()
    .max(DOCUMENT_METADATA_LIMITS.reviewFrequencyMonths)
    .nullish(),
  nextReviewOn: isoDate.nullish(),
})

const documentPatch = documentCreate.partial()

async function ensureDocumentType(tx: TenantTx, id: string | null | undefined): Promise<void> {
  if (!id) return
  const [type] = await tx
    .select({ id: documentTypes.id })
    .from(documentTypes)
    .where(and(eq(documentTypes.id, id), isNull(documentTypes.deletedAt)))
    .limit(1)
  if (!type) throw ApiError.invalid(`No document type with id ${id} in this tenant`)
}

async function ensureDocumentCategory(tx: TenantTx, id: string | null | undefined): Promise<void> {
  if (!id) return
  const [category] = await tx
    .select({ id: documentCategories.id })
    .from(documentCategories)
    .where(and(eq(documentCategories.id, id), isNull(documentCategories.deletedAt)))
    .limit(1)
  if (!category) throw ApiError.invalid(`No document category with id ${id} in this tenant`)
}

function documentResult(row: typeof documents.$inferSelect): WriteResult {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    type_id: row.typeId,
    category_id: row.categoryId,
    status: row.status,
    owner_tenant_user_id: row.ownerTenantUserId,
    review_frequency_months: row.reviewFrequencyMonths,
    next_review_on: row.nextReviewOn,
  }
}

async function createDocument(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = documentCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data
  const parsedKey = b.key ? parseDocumentKey(b.key) : null
  if (parsedKey && !parsedKey.ok) throw ApiError.invalid(parsedKey.error)
  const key =
    (parsedKey?.ok ? parsedKey.key : documentKeyFromTitle(b.title)) ||
    `document-${randomBytes(4).toString('hex')}`

  let row: typeof documents.$inferSelect | null
  try {
    row = await ctx.db(async (tx) => {
      await ensureDocumentType(tx, b.typeId)
      await ensureDocumentCategory(tx, b.categoryId)
      await ensureTenantUser(tx, b.ownerTenantUserId, 'document owner')

      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: ctx.tenantId,
          key,
          title: b.title,
          description: stripEmpty(b.description),
          typeId: b.typeId ?? null,
          categoryId: b.categoryId ?? null,
          status: 'draft',
          ownerTenantUserId: b.ownerTenantUserId ?? null,
          reviewFrequencyMonths: b.reviewFrequencyMonths ?? null,
          nextReviewOn: optionalDate(b.nextReviewOn),
        })
        .returning()
      if (!created) return null
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: created.id,
        action: 'create',
        summary: `Created document ${created.key}: ${created.title}`,
        after: {
          key: created.key,
          title: created.title,
          status: created.status,
          typeId: created.typeId,
          categoryId: created.categoryId,
        },
      })
      return created
    })
  } catch (error) {
    if (isDocumentKeyConflict(error)) {
      throw ApiError.conflict(`A live document already uses the key "${key}"`)
    }
    throw error
  }

  if (!row) throw new ApiError(500, 'internal', 'Failed to create document')
  revalidatePath('/documents')
  return documentResult(row)
}

async function updateDocument(ctx: RequestContext, id: string, raw: unknown): Promise<WriteResult> {
  const parsed = documentPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  let updated: typeof documents.$inferSelect | undefined
  try {
    updated = await ctx.db(async (tx) => {
      const [before] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
      if (!before || before.deletedAt) throw ApiError.notFound(`No documents with id ${id}`)

      await ensureDocumentType(tx, b.typeId)
      await ensureDocumentCategory(tx, b.categoryId)
      await ensureTenantUser(tx, b.ownerTenantUserId, 'document owner')

      const patch: Partial<typeof documents.$inferInsert> = {}
      if (hasOwn(b, 'title')) patch.title = b.title
      if (hasOwn(b, 'key') && b.key != null) {
        const parsedKey = parseDocumentKey(b.key)
        if (!parsedKey.ok) throw ApiError.invalid(parsedKey.error)
        patch.key = parsedKey.key
      }
      if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
      if (hasOwn(b, 'typeId')) patch.typeId = b.typeId ?? null
      if (hasOwn(b, 'categoryId')) patch.categoryId = b.categoryId ?? null
      if (hasOwn(b, 'ownerTenantUserId')) patch.ownerTenantUserId = b.ownerTenantUserId ?? null
      if (hasOwn(b, 'reviewFrequencyMonths')) {
        patch.reviewFrequencyMonths = b.reviewFrequencyMonths ?? null
      }
      if (hasOwn(b, 'nextReviewOn')) patch.nextReviewOn = optionalDate(b.nextReviewOn)
      assertPatchNotEmpty(patch)

      const [row] = await tx.update(documents).set(patch).where(eq(documents.id, id)).returning()
      if (row) {
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'document',
          entityId: id,
          action: row.status === 'published' ? 'publish' : 'update',
          summary: `Updated document ${row.key}: ${row.title}`,
          before: {
            key: before.key,
            title: before.title,
            status: before.status,
          },
          after: {
            key: row.key,
            title: row.title,
            status: row.status,
          },
        })
      }
      return row
    })
  } catch (error) {
    if (isDocumentKeyConflict(error)) {
      throw ApiError.conflict('A live document already uses that key')
    }
    throw error
  }

  if (!updated) throw new ApiError(500, 'internal', 'Failed to update document')
  revalidatePath('/documents')
  revalidatePath(`/documents/${id}`)
  return documentResult(updated)
}

async function deleteDocument(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) throw ApiError.notFound(`No documents with id ${id}`)
    const deleted = await softDeleteDocumentsInTransaction(tx, ctx.tenantId, [id])
    if (deleted.protectedIds.includes(id)) {
      throw ApiError.conflict(
        'This document is required by an active compliance obligation or a published book. End the obligation or unpublish the book first.',
      )
    }
    if (!deleted.deletedIds.includes(id)) throw ApiError.notFound(`No documents with id ${id}`)
    if (!deleted.deletedAt) throw new Error('Document deletion timestamp was not recorded')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: id,
      action: 'delete',
      summary: `Deleted document ${before.key}: ${before.title}`,
      before: {
        key: before.key,
        title: before.title,
        status: before.status,
      },
      after: { deletedAt: deleted.deletedAt },
    })
    return { before, deletedAt: deleted.deletedAt }
  })
  revalidatePath('/documents')
  revalidatePath(`/documents/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const DOCUMENT_BODY: Json = {
  type: 'object',
  required: ['title'],
  description:
    'Creates document metadata plus an empty editable draft. Content upload/import/publish stays in the document editor workflow.',
  properties: {
    title: { type: 'string', maxLength: 240 },
    key: { type: 'string', description: 'Slug. Defaults from title when omitted.' },
    description: { type: 'string' },
    typeId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    ownerTenantUserId: { type: 'string', format: 'uuid' },
    reviewFrequencyMonths: { type: 'integer', minimum: 1, maximum: 120 },
    nextReviewOn: { type: 'string', format: 'date' },
  },
}

const DOCUMENT_PATCH_BODY: Json = optionalObjectSchema(DOCUMENT_BODY)

// --- equipment ---------------------------------------------------------------

const equipmentCreate = z.object({
  assetTag: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  typeId: uuid.nullish(),
  categoryId: uuid.nullish(),
  serialNumber: z.string().max(200).nullish(),
  manufacturer: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  modelYear: z.number().int().min(1900).max(2100).nullish(),
  description: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
  status: z.enum(equipmentStatus.enumValues).default('in_service'),
  purchaseDate: isoDate.nullish(),
  purchasePrice: z.number().nonnegative().nullish(),
  purchaseVendor: z.string().max(240).nullish(),
  warrantyExpiresOn: isoDate.nullish(),
  currentSiteOrgUnitId: uuid.nullish(),
  currentHolderPersonId: uuid.nullish(),
  requiresPreUseInspection: z.boolean().default(false),
  requiresOilChange: z.boolean().default(false),
  oilChangeIntervalMonths: z.number().int().positive().nullish(),
  lastOilChangeOn: isoDate.nullish(),
  nextOilChangeDue: isoDate.nullish(),
  metadata,
})

type EquipmentReferenceInput = Pick<
  z.infer<typeof equipmentCreate>,
  'typeId' | 'categoryId' | 'currentSiteOrgUnitId' | 'currentHolderPersonId'
>

async function ensureEquipmentReferences(
  tx: TenantTx,
  input: EquipmentReferenceInput,
): Promise<void> {
  if (input.typeId) {
    const [type] = await tx
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, input.typeId))
      .limit(1)
    if (!type) throw ApiError.invalid(`No equipment type with id ${input.typeId} in this tenant`)
  }
  if (input.categoryId) {
    const [category] = await tx
      .select({ id: equipmentCategories.id })
      .from(equipmentCategories)
      .where(eq(equipmentCategories.id, input.categoryId))
      .limit(1)
    if (!category) {
      throw ApiError.invalid(`No equipment category with id ${input.categoryId} in this tenant`)
    }
  }
  await ensureSite(tx, input.currentSiteOrgUnitId)
  await ensurePerson(tx, input.currentHolderPersonId, 'holder')
  if (input.currentHolderPersonId) {
    const [activeHolder] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.currentHolderPersonId), eq(people.status, 'active')))
      .limit(1)
    if (!activeHolder) {
      throw ApiError.invalid(`Holder ${input.currentHolderPersonId} is not active`)
    }
  }
}

async function createEquipment(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = equipmentCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    await ensureEquipmentReferences(tx, b)

    const [existing] = await tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(eq(equipmentItems.assetTag, b.assetTag))
      .limit(1)
    if (existing) throw ApiError.invalid(`Equipment asset tag "${b.assetTag}" already exists`)

    const custodyRecordedAt = b.currentSiteOrgUnitId || b.currentHolderPersonId ? new Date() : null
    const [created] = await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        assetTag: b.assetTag,
        name: b.name,
        typeId: b.typeId ?? null,
        categoryId: b.categoryId ?? null,
        serialNumber: stripEmpty(b.serialNumber),
        manufacturer: stripEmpty(b.manufacturer),
        model: stripEmpty(b.model),
        modelYear: b.modelYear ?? null,
        description: stripEmpty(b.description),
        notes: stripEmpty(b.notes),
        qrToken: randomBytes(12).toString('base64url'),
        status: b.status,
        purchaseDate: optionalDate(b.purchaseDate),
        // numeric(12,2) column — drizzle expects a string; null passes through.
        purchasePrice: b.purchasePrice != null ? String(b.purchasePrice) : null,
        purchaseVendor: stripEmpty(b.purchaseVendor),
        warrantyExpiresOn: optionalDate(b.warrantyExpiresOn),
        currentSiteOrgUnitId: b.currentSiteOrgUnitId ?? null,
        currentHolderPersonId: b.currentHolderPersonId ?? null,
        lastSeenAt: custodyRecordedAt,
        lastSeenSiteOrgUnitId: b.currentSiteOrgUnitId ?? null,
        lastSeenHolderPersonId: b.currentHolderPersonId ?? null,
        requiresPreUseInspection: b.requiresPreUseInspection,
        requiresOilChange: b.requiresOilChange,
        oilChangeIntervalMonths: b.oilChangeIntervalMonths ?? null,
        lastOilChangeOn: optionalDate(b.lastOilChangeOn),
        nextOilChangeDue: optionalDate(b.nextOilChangeDue),
        isAvailableForCheckout: !b.currentHolderPersonId && b.status === 'in_service',
        metadata: b.metadata,
      })
      .returning()
    if (created && custodyRecordedAt) {
      await tx.insert(equipmentLocationHistory).values({
        tenantId: ctx.tenantId,
        itemId: created.id,
        siteOrgUnitId: b.currentSiteOrgUnitId ?? null,
        holderPersonId: b.currentHolderPersonId ?? null,
        recordedByTenantUserId: safeTenantUserId(ctx),
        recordedAt: custodyRecordedAt,
        note: 'Initial placement via public API',
      })
    }
    if (created) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment',
        entityId: created.id,
        action: 'create',
        summary: `Created equipment ${created.assetTag}: ${created.name}`,
        after: {
          assetTag: created.assetTag,
          name: created.name,
          status: created.status,
          currentSiteOrgUnitId: created.currentSiteOrgUnitId,
          currentHolderPersonId: created.currentHolderPersonId,
        },
      })
      await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [created.typeId])
    }
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create equipment item')
  revalidatePath('/equipment')
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')

  return equipmentResult(row)
}

function equipmentResult(row: typeof equipmentItems.$inferSelect): WriteResult {
  return {
    id: row.id,
    asset_tag: row.assetTag,
    name: row.name,
    serial_number: row.serialNumber,
    status: row.status,
    current_site_org_unit_id: row.currentSiteOrgUnitId,
    next_oil_change_due: row.nextOilChangeDue,
  }
}

const equipmentPatch = equipmentCreate.partial()

async function updateEquipment(
  ctx: RequestContext,
  id: string,
  raw: unknown,
): Promise<WriteResult> {
  const parsed = equipmentPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(equipmentItems)
      .where(eq(equipmentItems.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) throw ApiError.notFound(`No equipment with id ${id}`)

    await ensureEquipmentReferences(tx, b)

    const nextAssetTag = hasOwn(b, 'assetTag') ? b.assetTag : undefined
    if (nextAssetTag && nextAssetTag !== before.assetTag) {
      const [existing] = await tx
        .select({ id: equipmentItems.id })
        .from(equipmentItems)
        .where(eq(equipmentItems.assetTag, nextAssetTag))
        .limit(1)
      if (existing && existing.id !== id) {
        throw ApiError.invalid(`Equipment asset tag "${nextAssetTag}" already exists`)
      }
    }

    const patch: Partial<typeof equipmentItems.$inferInsert> = {}
    if (nextAssetTag) patch.assetTag = nextAssetTag
    if (hasOwn(b, 'name')) patch.name = b.name
    if (hasOwn(b, 'typeId')) patch.typeId = b.typeId ?? null
    if (hasOwn(b, 'categoryId')) patch.categoryId = b.categoryId ?? null
    if (hasOwn(b, 'serialNumber')) patch.serialNumber = stripEmpty(b.serialNumber)
    if (hasOwn(b, 'manufacturer')) patch.manufacturer = stripEmpty(b.manufacturer)
    if (hasOwn(b, 'model')) patch.model = stripEmpty(b.model)
    if (hasOwn(b, 'modelYear')) patch.modelYear = b.modelYear ?? null
    if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
    if (hasOwn(b, 'notes')) patch.notes = stripEmpty(b.notes)
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'purchaseDate')) patch.purchaseDate = optionalDate(b.purchaseDate)
    if (hasOwn(b, 'purchasePrice')) {
      // numeric(12,2) column — drizzle expects a string; null passes through.
      patch.purchasePrice = b.purchasePrice != null ? String(b.purchasePrice) : null
    }
    if (hasOwn(b, 'purchaseVendor')) patch.purchaseVendor = stripEmpty(b.purchaseVendor)
    if (hasOwn(b, 'warrantyExpiresOn')) {
      patch.warrantyExpiresOn = optionalDate(b.warrantyExpiresOn)
    }
    if (hasOwn(b, 'currentSiteOrgUnitId')) {
      patch.currentSiteOrgUnitId = b.currentSiteOrgUnitId ?? null
    }
    if (hasOwn(b, 'currentHolderPersonId')) {
      patch.currentHolderPersonId = b.currentHolderPersonId ?? null
    }
    if (hasOwn(b, 'requiresPreUseInspection')) {
      patch.requiresPreUseInspection = b.requiresPreUseInspection
    }
    if (hasOwn(b, 'requiresOilChange')) patch.requiresOilChange = b.requiresOilChange
    if (hasOwn(b, 'oilChangeIntervalMonths')) {
      patch.oilChangeIntervalMonths = b.oilChangeIntervalMonths ?? null
    }
    if (hasOwn(b, 'lastOilChangeOn')) patch.lastOilChangeOn = optionalDate(b.lastOilChangeOn)
    if (hasOwn(b, 'nextOilChangeDue')) patch.nextOilChangeDue = optionalDate(b.nextOilChangeDue)
    if (hasOwn(b, 'metadata')) patch.metadata = b.metadata

    const nextHolder = hasOwn(b, 'currentHolderPersonId')
      ? (b.currentHolderPersonId ?? null)
      : before.currentHolderPersonId
    const nextSite = hasOwn(b, 'currentSiteOrgUnitId')
      ? (b.currentSiteOrgUnitId ?? null)
      : before.currentSiteOrgUnitId
    const custodyChanged =
      nextSite !== before.currentSiteOrgUnitId || nextHolder !== before.currentHolderPersonId
    const custodyChangedAt = custodyChanged ? new Date() : null
    if (custodyChanged) {
      const openIds = await openEquipmentCheckoutItemIds(tx, [id])
      if (openIds.has(id)) {
        throw ApiError.invalid('Check this equipment item in before changing direct custody')
      }
      patch.lastSeenAt = custodyChangedAt
      patch.lastSeenSiteOrgUnitId = nextSite
      patch.lastSeenHolderPersonId = nextHolder
      patch.isMissing = false
      if (before.isMissing) patch.missingFoundAt = custodyChangedAt
    }
    assertPatchNotEmpty(patch)

    await tx.update(equipmentItems).set(patch).where(eq(equipmentItems.id, id))
    if (hasOwn(b, 'currentHolderPersonId') || hasOwn(b, 'status') || custodyChanged) {
      await refreshEquipmentAvailability(tx, [id])
    }
    if (b.status !== undefined && b.status !== before.status) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'equipment-assets',
        event: 'status_change',
        toStatus: b.status,
        occurrenceKey: randomUUID(),
      })
    }

    if (custodyChanged) {
      await tx.insert(equipmentLocationHistory).values({
        tenantId: ctx.tenantId,
        itemId: id,
        siteOrgUnitId: nextSite,
        holderPersonId: nextHolder,
        recordedByTenantUserId: safeTenantUserId(ctx),
        recordedAt: custodyChangedAt!,
        note: 'Updated via public API',
      })
    }

    const [updated] = await tx
      .select()
      .from(equipmentItems)
      .where(eq(equipmentItems.id, id))
      .limit(1)

    if (updated) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Updated equipment ${updated.assetTag}: ${updated.name}`,
        before: {
          assetTag: before.assetTag,
          name: before.name,
          status: before.status,
          currentSiteOrgUnitId: before.currentSiteOrgUnitId,
          currentHolderPersonId: before.currentHolderPersonId,
        },
        after: {
          assetTag: updated.assetTag,
          name: updated.name,
          status: updated.status,
          currentSiteOrgUnitId: updated.currentSiteOrgUnitId,
          currentHolderPersonId: updated.currentHolderPersonId,
        },
      })
      await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [before.typeId, updated.typeId])
    }

    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update equipment item')
  revalidatePath('/equipment')
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
  return equipmentResult(result.updated)
}

async function deleteEquipment(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(equipmentItems)
      .where(eq(equipmentItems.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) throw ApiError.notFound(`No equipment with id ${id}`)
    const openIds = await openEquipmentCheckoutItemIds(tx, [id])
    if (openIds.has(id)) {
      throw ApiError.invalid('Check this equipment item in before archiving it')
    }
    if (before.currentHolderPersonId) {
      throw ApiError.invalid('Clear this equipment item’s holder before archiving it')
    }
    const deletedAt = new Date()
    await tx.update(equipmentItems).set({ deletedAt }).where(eq(equipmentItems.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: id,
      action: 'delete',
      summary: `Archived equipment ${before.assetTag}: ${before.name}`,
      before: {
        assetTag: before.assetTag,
        name: before.name,
        status: before.status,
      },
      after: { deletedAt },
    })
    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [before.typeId])
    return { before, deletedAt }
  })
  revalidatePath('/equipment')
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const EQUIPMENT_BODY: Json = {
  type: 'object',
  required: ['assetTag', 'name'],
  properties: {
    assetTag: { type: 'string' },
    name: { type: 'string' },
    typeId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    serialNumber: { type: 'string' },
    manufacturer: { type: 'string' },
    model: { type: 'string' },
    modelYear: { type: 'integer', minimum: 1900, maximum: 2100 },
    description: { type: 'string' },
    notes: { type: 'string' },
    status: { type: 'string', enum: equipmentStatus.enumValues, default: 'in_service' },
    purchaseDate: { type: 'string', format: 'date' },
    purchasePrice: { type: 'number', minimum: 0 },
    purchaseVendor: { type: 'string' },
    warrantyExpiresOn: { type: 'string', format: 'date' },
    currentSiteOrgUnitId: { type: 'string', format: 'uuid' },
    currentHolderPersonId: { type: 'string', format: 'uuid' },
    requiresPreUseInspection: { type: 'boolean', default: false },
    requiresOilChange: { type: 'boolean', default: false },
    oilChangeIntervalMonths: { type: 'integer', minimum: 1 },
    lastOilChangeOn: { type: 'string', format: 'date' },
    nextOilChangeDue: { type: 'string', format: 'date' },
    metadata: { type: 'object', additionalProperties: true },
  },
}

const EQUIPMENT_PATCH_BODY = optionalObjectSchema(EQUIPMENT_BODY)

// --- ppe ---------------------------------------------------------------------

const ppeCreate = z.object({
  typeId: uuid,
  serialNumber: z.string().max(200).nullish(),
  size: z.string().max(80).nullish(),
  status: z.enum(ppeItemStatus.enumValues).default('in_stock'),
  currentHolderPersonId: uuid.nullish(),
  purchaseDate: isoDate.nullish(),
  expiresOn: isoDate.nullish(),
  notes: z.string().max(5000).nullish(),
  lastInspectionOn: isoDate.nullish(),
  nextInspectionDue: isoDate.nullish(),
  lastAnnualInspectionOn: isoDate.nullish(),
  nextAnnualInspectionDue: isoDate.nullish(),
  metadata,
})

async function createPpe(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = ppeCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: ppeTypes.id })
      .from(ppeTypes)
      .where(eq(ppeTypes.id, b.typeId))
      .limit(1)
    if (!type) throw ApiError.invalid(`No PPE type with id ${b.typeId} in this tenant`)
    await ensurePerson(tx, b.currentHolderPersonId, 'holder')

    if (b.serialNumber) {
      const [existing] = await tx
        .select({ id: ppeItems.id })
        .from(ppeItems)
        .where(eq(ppeItems.serialNumber, b.serialNumber))
        .limit(1)
      if (existing) throw ApiError.invalid(`PPE serial number "${b.serialNumber}" already exists`)
    }

    const [created] = await tx
      .insert(ppeItems)
      .values({
        tenantId: ctx.tenantId,
        typeId: b.typeId,
        serialNumber: stripEmpty(b.serialNumber),
        size: stripEmpty(b.size),
        status: b.status,
        currentHolderPersonId: b.currentHolderPersonId ?? null,
        purchaseDate: optionalDate(b.purchaseDate),
        expiresOn: optionalDate(b.expiresOn),
        notes: stripEmpty(b.notes),
        lastInspectionOn: optionalDate(b.lastInspectionOn),
        nextInspectionDue: optionalDate(b.nextInspectionDue),
        lastAnnualInspectionOn: optionalDate(b.lastAnnualInspectionOn),
        nextAnnualInspectionDue: optionalDate(b.nextAnnualInspectionDue),
        metadata: b.metadata,
      })
      .returning()
    if (created) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'ppe_item',
        entityId: created.id,
        action: 'create',
        summary: `Added PPE item${created.serialNumber ? ` ${created.serialNumber}` : ''}`,
        after: {
          typeId: created.typeId,
          serialNumber: created.serialNumber,
          status: created.status,
          currentHolderPersonId: created.currentHolderPersonId,
        },
      })
      await materializePpeTypeEvidence(tx, ctx.tenantId, [created.typeId])
    }
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create PPE item')
  revalidatePath('/ppe')

  return ppeResult(row)
}

function ppeResult(row: typeof ppeItems.$inferSelect): WriteResult {
  return {
    id: row.id,
    serial_number: row.serialNumber,
    size: row.size,
    status: row.status,
    current_holder_person_id: row.currentHolderPersonId,
    last_inspection_on: row.lastInspectionOn,
    next_inspection_due: row.nextInspectionDue,
    next_annual_inspection_due: row.nextAnnualInspectionDue,
    purchase_date: row.purchaseDate,
    expires_on: row.expiresOn,
  }
}

const ppePatch = ppeCreate.partial()

async function updatePpe(ctx: RequestContext, id: string, raw: unknown): Promise<WriteResult> {
  const parsed = ppePatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(ppeItems)
      .where(eq(ppeItems.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) throw ApiError.notFound(`No ppe with id ${id}`)

    if (b.typeId) {
      const [type] = await tx
        .select({ id: ppeTypes.id })
        .from(ppeTypes)
        .where(eq(ppeTypes.id, b.typeId))
        .limit(1)
      if (!type) throw ApiError.invalid(`No PPE type with id ${b.typeId} in this tenant`)
    }
    await ensurePerson(tx, b.currentHolderPersonId, 'holder')

    if (hasOwn(b, 'serialNumber') && b.serialNumber && b.serialNumber !== before.serialNumber) {
      const [existing] = await tx
        .select({ id: ppeItems.id })
        .from(ppeItems)
        .where(eq(ppeItems.serialNumber, b.serialNumber))
        .limit(1)
      if (existing && existing.id !== id) {
        throw ApiError.invalid(`PPE serial number "${b.serialNumber}" already exists`)
      }
    }

    const patch: Partial<typeof ppeItems.$inferInsert> = {}
    if (hasOwn(b, 'typeId')) patch.typeId = b.typeId
    if (hasOwn(b, 'serialNumber')) patch.serialNumber = stripEmpty(b.serialNumber)
    if (hasOwn(b, 'size')) patch.size = stripEmpty(b.size)
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'currentHolderPersonId')) {
      patch.currentHolderPersonId = b.currentHolderPersonId ?? null
    }
    if (hasOwn(b, 'purchaseDate')) patch.purchaseDate = optionalDate(b.purchaseDate)
    if (hasOwn(b, 'expiresOn')) patch.expiresOn = optionalDate(b.expiresOn)
    if (hasOwn(b, 'notes')) patch.notes = stripEmpty(b.notes)
    if (hasOwn(b, 'lastInspectionOn')) patch.lastInspectionOn = optionalDate(b.lastInspectionOn)
    if (hasOwn(b, 'nextInspectionDue')) patch.nextInspectionDue = optionalDate(b.nextInspectionDue)
    if (hasOwn(b, 'lastAnnualInspectionOn')) {
      patch.lastAnnualInspectionOn = optionalDate(b.lastAnnualInspectionOn)
    }
    if (hasOwn(b, 'nextAnnualInspectionDue')) {
      patch.nextAnnualInspectionDue = optionalDate(b.nextAnnualInspectionDue)
    }
    if (hasOwn(b, 'metadata')) patch.metadata = b.metadata
    assertPatchNotEmpty(patch)

    const [updated] = await tx.update(ppeItems).set(patch).where(eq(ppeItems.id, id)).returning()
    if (updated) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'ppe_item',
        entityId: id,
        action: 'update',
        summary: `Updated PPE item${updated.serialNumber ? ` ${updated.serialNumber}` : ''}`,
        before: {
          typeId: before.typeId,
          serialNumber: before.serialNumber,
          status: before.status,
          currentHolderPersonId: before.currentHolderPersonId,
        },
        after: {
          typeId: updated.typeId,
          serialNumber: updated.serialNumber,
          status: updated.status,
          currentHolderPersonId: updated.currentHolderPersonId,
        },
      })
      await materializePpeTypeEvidence(tx, ctx.tenantId, [before.typeId, updated.typeId])
    }
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update PPE item')
  revalidatePath('/ppe')
  revalidatePath(`/ppe/${id}`)
  return ppeResult(result.updated)
}

async function deletePpe(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(ppeItems)
      .where(eq(ppeItems.id, id))
      .limit(1)
      .for('update')
    if (!before || before.deletedAt) throw ApiError.notFound(`No ppe with id ${id}`)
    const deletedAt = new Date()
    await tx.update(ppeItems).set({ deletedAt }).where(eq(ppeItems.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_item',
      entityId: id,
      action: 'delete',
      summary: `Archived PPE item${before.serialNumber ? ` ${before.serialNumber}` : ''}`,
      before: {
        typeId: before.typeId,
        serialNumber: before.serialNumber,
        status: before.status,
      },
      after: { deletedAt },
    })
    await materializePpeTypeEvidence(tx, ctx.tenantId, [before.typeId])
    return { before, deletedAt }
  })
  revalidatePath('/ppe')
  revalidatePath(`/ppe/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

const PPE_BODY: Json = {
  type: 'object',
  required: ['typeId'],
  properties: {
    typeId: { type: 'string', format: 'uuid' },
    serialNumber: { type: 'string' },
    size: { type: 'string' },
    status: { type: 'string', enum: ppeItemStatus.enumValues, default: 'in_stock' },
    currentHolderPersonId: { type: 'string', format: 'uuid' },
    purchaseDate: { type: 'string', format: 'date' },
    expiresOn: { type: 'string', format: 'date' },
    notes: { type: 'string' },
    lastInspectionOn: { type: 'string', format: 'date' },
    nextInspectionDue: { type: 'string', format: 'date' },
    lastAnnualInspectionOn: { type: 'string', format: 'date' },
    nextAnnualInspectionDue: { type: 'string', format: 'date' },
    metadata: { type: 'object', additionalProperties: true },
  },
}

const PPE_PATCH_BODY = optionalObjectSchema(PPE_BODY)

// --- training_records --------------------------------------------------------

async function materializeTrainingRecordCourses(
  tx: TenantTx,
  tenantId: string,
  courseIds: readonly (string | null)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(courseIds.filter((id): id is string => Boolean(id)))].map((courseId) => ({
      sourceModule: 'training' as const,
      targetRef: { courseId },
    })),
  )
}

const trainingRecordCreate = z.object({
  personId: uuid,
  courseId: uuid,
  completedOn: isoDate,
  source: z.enum(trainingRecordSource.enumValues).default('external_upload'),
  expiresOn: isoDate.nullish(),
  score: z.number().int().nullish(),
  grade: z.number().int().min(0).max(100).nullish(),
  instructor: z.string().max(200).nullish(),
  evaluatorPersonId: uuid.nullish(),
  details: z.string().max(2000).nullish(),
  notes: z.string().max(2000).nullish(),
})

async function createTrainingRecord(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = trainingRecordCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    // FK existence is checked under RLS so a caller can't reference another
    // tenant's person/course (the FK targets are global PKs; RLS scopes the read).
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, b.personId))
      .limit(1)
    if (!person) throw ApiError.invalid(`No person with id ${b.personId} in this tenant`)
    const [course] = await tx
      .select({ id: trainingCourses.id })
      .from(trainingCourses)
      .where(eq(trainingCourses.id, b.courseId))
      .limit(1)
    if (!course) throw ApiError.invalid(`No training course with id ${b.courseId} in this tenant`)
    await ensurePerson(tx, b.evaluatorPersonId, 'evaluator')

    const [created] = await tx
      .insert(trainingRecords)
      .values({
        tenantId: ctx.tenantId,
        personId: b.personId,
        courseId: b.courseId,
        source: b.source,
        completedOn: b.completedOn,
        expiresOn: b.expiresOn ?? null,
        score: b.score ?? null,
        grade: b.grade ?? null,
        instructor: b.instructor ?? null,
        evaluatorPersonId: b.evaluatorPersonId ?? null,
        details: b.details ?? null,
        notes: b.notes ?? null,
        issuedByTenantUserId: safeTenantUserId(ctx),
      })
      .returning()
    if (!created) throw new ApiError(500, 'internal', 'Failed to create training record')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: created.id,
      action: 'create',
      summary: 'Created training record via API',
      after: {
        personId: created.personId,
        courseId: created.courseId,
        source: created.source,
        completedOn: created.completedOn,
      },
    })
    await materializeTrainingRecordCourses(tx, ctx.tenantId, [created.courseId])
    return created
  })

  revalidatePath('/training')

  return trainingRecordResult(row)
}

function trainingRecordResult(row: typeof trainingRecords.$inferSelect): WriteResult {
  return {
    id: row.id,
    person_id: row.personId,
    course_id: row.courseId,
    completed_on: row.completedOn,
    expires_on: row.expiresOn ?? null,
    source: row.source,
    score: row.score ?? null,
    grade: row.grade ?? null,
  }
}

const trainingRecordPatch = trainingRecordCreate.partial()

async function updateTrainingRecord(
  ctx: RequestContext,
  id: string,
  raw: unknown,
): Promise<WriteResult> {
  const parsed = trainingRecordPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .for('update')
      .limit(1)
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No training_records with id ${id}`)
    }
    if (b.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, b.personId))
        .limit(1)
      if (!person) throw ApiError.invalid(`No person with id ${b.personId} in this tenant`)
    }
    if (b.courseId) {
      const [course] = await tx
        .select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(eq(trainingCourses.id, b.courseId))
        .limit(1)
      if (!course) {
        throw ApiError.invalid(`No training course with id ${b.courseId} in this tenant`)
      }
    }
    await ensurePerson(tx, b.evaluatorPersonId, 'evaluator')

    const patch: Partial<typeof trainingRecords.$inferInsert> = {}
    if (hasOwn(b, 'personId')) patch.personId = b.personId
    if (hasOwn(b, 'courseId')) patch.courseId = b.courseId
    if (hasOwn(b, 'completedOn')) patch.completedOn = b.completedOn
    if (hasOwn(b, 'source')) patch.source = b.source
    if (hasOwn(b, 'expiresOn')) patch.expiresOn = b.expiresOn ?? null
    if (hasOwn(b, 'score')) patch.score = b.score ?? null
    if (hasOwn(b, 'grade')) patch.grade = b.grade ?? null
    if (hasOwn(b, 'instructor')) patch.instructor = stripEmpty(b.instructor)
    if (hasOwn(b, 'evaluatorPersonId')) patch.evaluatorPersonId = b.evaluatorPersonId ?? null
    if (hasOwn(b, 'details')) patch.details = stripEmpty(b.details)
    if (hasOwn(b, 'notes')) patch.notes = stripEmpty(b.notes)
    assertPatchNotEmpty(patch)

    const [updated] = await tx
      .update(trainingRecords)
      .set(patch)
      .where(eq(trainingRecords.id, id))
      .returning()
    if (!updated) throw new ApiError(500, 'internal', 'Failed to update training record')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: id,
      action: 'update',
      summary: 'Updated training record via API',
      before: {
        personId: before.personId,
        courseId: before.courseId,
        completedOn: before.completedOn,
        expiresOn: before.expiresOn,
      },
      after: {
        personId: updated.personId,
        courseId: updated.courseId,
        completedOn: updated.completedOn,
        expiresOn: updated.expiresOn,
      },
    })
    if (
      hasOwn(b, 'personId') ||
      hasOwn(b, 'courseId') ||
      hasOwn(b, 'completedOn') ||
      hasOwn(b, 'expiresOn')
    ) {
      await materializeTrainingRecordCourses(tx, ctx.tenantId, [before.courseId, updated.courseId])
    }
    return { before, updated }
  })

  revalidatePath('/training')
  revalidatePath(`/training/records/${id}`)
  return trainingRecordResult(result.updated)
}

async function deleteTrainingRecord(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .for('update')
      .limit(1)
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No training_records with id ${id}`)
    }
    const deletedAt = new Date()
    const [revoked] = await tx
      .update(trainingRecords)
      .set({ deletedAt })
      .where(and(eq(trainingRecords.id, id), isNull(trainingRecords.deletedAt)))
      .returning({ id: trainingRecords.id })
    if (!revoked) throw new ApiError(500, 'internal', 'Failed to revoke training record')
    await tx
      .update(trainingCertificates)
      .set({ revokedAt: deletedAt, revokedReason: 'Training record revoked via API' })
      .where(and(eq(trainingCertificates.recordId, id), isNull(trainingCertificates.revokedAt)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: id,
      action: 'delete',
      summary: 'Revoked training record via API',
      before: {
        personId: before.personId,
        courseId: before.courseId,
        completedOn: before.completedOn,
        expiresOn: before.expiresOn,
      },
      after: { deletedAt },
    })
    await materializeTrainingRecordCourses(tx, ctx.tenantId, [before.courseId])
    return { before, deletedAt }
  })
  revalidatePath('/training')
  revalidatePath(`/training/records/${id}`)
  return { id, deleted: true, deletedAt: result.deletedAt.toISOString() }
}

// OpenAPI requestBody schema, co-located with the validator so docs match.
const TRAINING_RECORD_BODY: Json = {
  type: 'object',
  required: ['personId', 'courseId', 'completedOn'],
  properties: {
    personId: {
      type: 'string',
      format: 'uuid',
      description: 'Person earning the training (must belong to your tenant).',
    },
    courseId: {
      type: 'string',
      format: 'uuid',
      description: 'Training course (must belong to your tenant).',
    },
    completedOn: { type: 'string', format: 'date' },
    source: {
      type: 'string',
      enum: trainingRecordSource.enumValues,
      default: 'external_upload',
    },
    expiresOn: { type: 'string', format: 'date' },
    score: { type: 'integer' },
    grade: { type: 'integer', minimum: 0, maximum: 100 },
    instructor: { type: 'string' },
    evaluatorPersonId: { type: 'string', format: 'uuid' },
    details: { type: 'string' },
    notes: { type: 'string' },
  },
}

const TRAINING_RECORD_PATCH_BODY = optionalObjectSchema(TRAINING_RECORD_BODY)

// --- registry ----------------------------------------------------------------

const WRITES: Record<string, WriteRegistration> = {
  incidents: {
    permission: 'incidents.create',
    handler: createIncident,
    bodySchema: INCIDENT_BODY,
    update: {
      permission: 'incidents.update',
      handler: updateIncident,
      bodySchema: INCIDENT_PATCH_BODY,
    },
    delete: {
      permission: 'incidents.update',
      handler: deleteIncident,
    },
  },
  corrective_actions: {
    permission: 'ca.create',
    handler: createCorrectiveAction,
    bodySchema: CORRECTIVE_ACTION_BODY,
    update: {
      permission: 'ca.update',
      handler: updateCorrectiveAction,
      bodySchema: CORRECTIVE_ACTION_PATCH_BODY,
    },
    delete: {
      permission: 'ca.update',
      handler: deleteCorrectiveAction,
    },
  },
  inspections: {
    permission: 'inspections.create',
    handler: createInspection,
    bodySchema: INSPECTION_BODY,
    update: {
      permission: 'inspections.update',
      handler: updateInspection,
      bodySchema: INSPECTION_PATCH_BODY,
    },
    delete: {
      permission: 'inspections.manage',
      handler: deleteInspection,
    },
  },
  documents: {
    permission: 'documents.manage',
    handler: createDocument,
    bodySchema: DOCUMENT_BODY,
    update: {
      permission: 'documents.manage',
      handler: updateDocument,
      bodySchema: DOCUMENT_PATCH_BODY,
    },
    delete: {
      permission: 'documents.manage',
      handler: deleteDocument,
    },
  },
  equipment: {
    permission: 'equipment.manage',
    handler: createEquipment,
    bodySchema: EQUIPMENT_BODY,
    update: {
      permission: 'equipment.manage',
      handler: updateEquipment,
      bodySchema: EQUIPMENT_PATCH_BODY,
    },
    delete: {
      permission: 'equipment.manage',
      handler: deleteEquipment,
    },
  },
  ppe: {
    permission: 'ppe.manage',
    handler: createPpe,
    bodySchema: PPE_BODY,
    update: {
      permission: 'ppe.manage',
      handler: updatePpe,
      bodySchema: PPE_PATCH_BODY,
    },
    delete: {
      permission: 'ppe.manage',
      handler: deletePpe,
    },
  },
  training_records: {
    permission: 'training.record.create',
    handler: createTrainingRecord,
    bodySchema: TRAINING_RECORD_BODY,
    update: {
      permission: 'training.record.create',
      handler: updateTrainingRecord,
      bodySchema: TRAINING_RECORD_PATCH_BODY,
    },
    delete: {
      permission: 'training.record.create',
      handler: deleteTrainingRecord,
    },
  },
}

export function isWritable(entityKey: string): boolean {
  return entityKey in WRITES
}

export function isPatchable(entityKey: string): boolean {
  return Boolean(WRITES[entityKey]?.update)
}

export function isDeletable(entityKey: string): boolean {
  return Boolean(WRITES[entityKey]?.delete)
}

/** OpenAPI requestBody schema for a writable entity, or null. */
export function writeBodySchema(entityKey: string): Json | null {
  return WRITES[entityKey]?.bodySchema ?? null
}

/** OpenAPI requestBody schema for a patchable entity, or null. */
export function patchBodySchema(entityKey: string): Json | null {
  return WRITES[entityKey]?.update?.bodySchema ?? null
}

/** Permission required to POST-create this entity. */
export function writePermissionForEntity(entityKey: string): string | null {
  return WRITES[entityKey]?.permission ?? null
}

/** Permission required to PATCH-update this entity. */
export function patchPermissionForEntity(entityKey: string): string | null {
  return WRITES[entityKey]?.update?.permission ?? null
}

/** Permission required to DELETE/archive this entity. */
export function deletePermissionForEntity(entityKey: string): string | null {
  return WRITES[entityKey]?.delete?.permission ?? null
}

export async function createEntity(
  ctx: RequestContext,
  entityKey: string,
  body: unknown,
): Promise<WriteResult> {
  const entry = WRITES[entityKey]
  if (!entry) throw ApiError.methodNotAllowed(`Writes are not supported for "${entityKey}"`)
  return entry.handler(ctx, body)
}

export async function patchEntity(
  ctx: RequestContext,
  entityKey: string,
  id: string,
  body: unknown,
): Promise<WriteResult> {
  const entry = WRITES[entityKey]?.update
  if (!entry) throw ApiError.methodNotAllowed(`Updates are not supported for "${entityKey}"`)
  return entry.handler(ctx, id, body)
}

export async function deleteEntity(
  ctx: RequestContext,
  entityKey: string,
  id: string,
): Promise<WriteResult> {
  const entry = WRITES[entityKey]?.delete
  if (!entry) throw ApiError.methodNotAllowed(`Deletes are not supported for "${entityKey}"`)
  return entry.handler(ctx, id)
}
