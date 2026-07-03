// Write handlers for the public API. Writes do NOT go through the read registry
// (that includes views and only a reporting subset of columns) — each writable
// entity has a hand-written, validated create that mirrors the real server
// action: zod-validated body, tenant-scoped FK checks, insert, audit. Adding an
// entity = add a handler here; `WRITABLE_ENTITY_KEYS` and OpenAPI are derived
// from this map, so docs and runtime permissions stay in sync.

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import {
  correctiveActionSeverity,
  correctiveActionStatus,
  correctiveActionSource,
  correctiveActions,
  departments,
  documentCategories,
  documentDrafts,
  documents,
  documentStatus,
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
  trainingCourses,
  trainingRecords,
  trainingRecordSource,
} from '@beaconhs/db/schema'
import { emitCorrectiveActionAssigned, emitIncidentReported } from '@beaconhs/events'
import { emitCorrectiveActionCreated, emitIncidentCreated } from '@beaconhs/integrations'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { findIncompleteCriteria, materialiseCriteriaForRecord } from '@/app/(app)/inspections/_lib'
import { ApiError } from './errors'

type Json = Record<string, unknown>
export type WriteResult = { id: string; [k: string]: unknown }
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

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'Expected a uuid',
})
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
  emsNotified: z.boolean().default(false),
  firstAidReceived: z.boolean().default(false),
  firstAidProvider: z.string().max(200).nullish(),
  medicalAttentionReceived: z.boolean().default(false),
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

    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(sql`extract(year from ${incidents.occurredAt}) = ${year}`)
    const reference = `INC-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`

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
        emsNotified: b.emsNotified,
        firstAidReceived: b.firstAidReceived,
        firstAidProvider: stripEmpty(b.firstAidProvider),
        medicalAttentionReceived: b.medicalAttentionReceived,
        actualSeverity: b.actualSeverity ?? null,
        potentialSeverity: b.potentialSeverity ?? null,
        severityRating: b.severityRating ?? null,
      })
      .returning()
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
  await emitIncidentReported(ctx, { incidentId: row.id })
  await runModuleFlows(ctx, { moduleKey: 'incidents', event: 'on_create', subjectId: row.id })
  await emitIncidentCreated(ctx, {
    id: row.id,
    reference: row.reference,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    occurredAt: row.occurredAt,
    location: row.location,
  }).catch(() => {})
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
    if (hasOwn(b, 'emsNotified')) patch.emsNotified = b.emsNotified
    if (hasOwn(b, 'firstAidReceived')) patch.firstAidReceived = b.firstAidReceived
    if (hasOwn(b, 'firstAidProvider')) patch.firstAidProvider = stripEmpty(b.firstAidProvider)
    if (hasOwn(b, 'medicalAttentionReceived')) {
      patch.medicalAttentionReceived = b.medicalAttentionReceived
    }
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
    emsNotified: { type: 'boolean', default: false },
    firstAidReceived: { type: 'boolean', default: false },
    firstAidProvider: { type: 'string' },
    medicalAttentionReceived: { type: 'boolean', default: false },
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

    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(
        sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`,
      )
    const reference = `CA-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`

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
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create corrective action')
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: row.id,
    action: 'create',
    summary: `Created ${row.reference}: ${row.title}`,
    after: {
      reference: row.reference,
      severity: row.severity,
      source: row.source,
      dueOn: row.dueOn,
      siteOrgUnitId: row.siteOrgUnitId,
    },
  })
  await emitCorrectiveActionAssigned(ctx, {
    caId: row.id,
    assigneeUserId: null,
    assignerUserId: null,
  })
  await runModuleFlows(ctx, {
    moduleKey: 'corrective-actions',
    event: 'on_create',
    subjectId: row.id,
  })
  await emitCorrectiveActionCreated(ctx, {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    severity: row.severity,
    source: row.source,
    dueOn: row.dueOn,
    assignedOn: row.assignedOn,
  }).catch(() => {})
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
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update corrective action')
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: `Updated ${result.updated.reference}: ${result.updated.title}`,
    before: {
      title: result.before.title,
      status: result.before.status,
      severity: result.before.severity,
      ownerTenantUserId: result.before.ownerTenantUserId,
    },
    after: {
      title: result.updated.title,
      status: result.updated.status,
      severity: result.updated.severity,
      ownerTenantUserId: result.updated.ownerTenantUserId,
    },
  })
  if (result.before.status !== result.updated.status) {
    await runModuleFlows(ctx, {
      moduleKey: 'corrective-actions',
      event: 'status_change',
      subjectId: id,
      toStatus: result.updated.status,
    })
  }
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
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No corrective_actions with id ${id}`)
    }
    if (before.locked) throw ApiError.invalid('Corrective action is locked and cannot be archived')
    const deletedAt = new Date()
    await tx.update(correctiveActions).set({ deletedAt }).where(eq(correctiveActions.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'corrective_action',
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

async function nextInspectionReferenceInTx(tx: TenantTx, occurredAt: Date): Promise<string> {
  const year = occurredAt.getFullYear()
  const [{ c } = { c: 0 }] = await tx
    .select({ c: count() })
    .from(inspectionRecords)
    .where(sql`extract(year from ${inspectionRecords.occurredAt}) = ${year}`)
  return `INS-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
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

    const reference = await nextInspectionReferenceInTx(tx, occurredAt)
    const [created] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        typeId: b.typeId,
        status: 'draft',
        occurredAt,
        siteOrgUnitId: b.siteOrgUnitId ?? null,
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
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create inspection record')
  const materialised = await materialiseCriteriaForRecord(ctx, row.id, row.typeId)
  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: row.id,
    action: 'create',
    summary: `Started ${row.reference} — materialised ${materialised} criteria`,
    after: {
      reference: row.reference,
      typeId: row.typeId,
      occurredAt: row.occurredAt,
      siteOrgUnitId: row.siteOrgUnitId,
    },
  })
  await runModuleFlows(ctx, { moduleKey: 'inspections', event: 'on_create', subjectId: row.id })
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
    const [before] = await tx
      .select()
      .from(inspectionRecords)
      .where(eq(inspectionRecords.id, id))
      .limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No inspections with id ${id}`)
    if (before.locked) throw ApiError.invalid('Inspection is locked and cannot be updated')

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
    if (hasOwn(b, 'status')) {
      patch.status = b.status
      if (b.status === 'submitted' || b.status === 'closed') {
        const missing = await findIncompleteCriteria(ctx, id)
        if (missing.length > 0) {
          throw ApiError.invalid(
            `Cannot submit: ${missing.length} inspection item${missing.length === 1 ? '' : 's'} incomplete`,
            missing,
          )
        }
        patch.submittedAt = new Date()
        patch.submittedByTenantUserId = safeTenantUserId(ctx)
      }
      if (b.status === 'closed') {
        patch.closedAt = new Date()
        patch.closedByTenantUserId = safeTenantUserId(ctx)
        patch.locked = true
      }
      if (b.status === 'draft' || b.status === 'in_progress') {
        patch.submittedAt = null
        patch.submittedByTenantUserId = null
        patch.closedAt = null
        patch.closedByTenantUserId = null
      }
    }
    assertPatchNotEmpty(patch)

    const [updated] = await tx
      .update(inspectionRecords)
      .set(patch)
      .where(eq(inspectionRecords.id, id))
      .returning()
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update inspection record')
  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: id,
    action: 'update',
    summary: `Updated ${result.updated.reference}`,
    before: {
      status: result.before.status,
      occurredAt: result.before.occurredAt,
      siteOrgUnitId: result.before.siteOrgUnitId,
    },
    after: {
      status: result.updated.status,
      occurredAt: result.updated.occurredAt,
      siteOrgUnitId: result.updated.siteOrgUnitId,
    },
  })
  if (result.before.status !== result.updated.status) {
    await runModuleFlows(ctx, {
      moduleKey: 'inspections',
      event: 'status_change',
      subjectId: id,
      toStatus: result.updated.status,
    })
    if (result.updated.status === 'submitted') {
      await runModuleFlows(ctx, { moduleKey: 'inspections', event: 'on_submit', subjectId: id })
    }
  }
  revalidatePath('/inspections/records')
  revalidatePath(`/inspections/records/${id}`)
  return inspectionResult(result.updated)
}

async function deleteInspection(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(inspectionRecords)
      .where(eq(inspectionRecords.id, id))
      .limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No inspections with id ${id}`)
    if (before.locked) throw ApiError.invalid('Inspection is locked and cannot be archived')
    const deletedAt = new Date()
    await tx.update(inspectionRecords).set({ deletedAt }).where(eq(inspectionRecords.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: id,
    action: 'delete',
    summary: `Archived ${result.before.reference}`,
    before: {
      reference: result.before.reference,
      status: result.before.status,
      occurredAt: result.before.occurredAt,
    },
    after: { deletedAt: result.deletedAt },
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
      description: 'Submitting or closing requires all materialized criteria to be complete.',
    },
  },
}

// --- documents ---------------------------------------------------------------

const documentCreate = z.object({
  title: z.string().trim().min(1).max(240),
  key: z.string().trim().max(160).nullish(),
  description: z.string().max(5000).nullish(),
  category: z.string().max(200).nullish(),
  typeId: uuid.nullish(),
  categoryId: uuid.nullish(),
  ownerTenantUserId: uuid.nullish(),
  reviewFrequencyMonths: z.number().int().positive().max(120).nullish(),
  nextReviewOn: isoDate.nullish(),
  requiredForRoleKeys: z.array(z.string().trim().min(1).max(120)).default([]),
  requiredForTradeIds: z.array(uuid).default([]),
  printHeader: z.boolean().default(true),
  printFooter: z.boolean().default(true),
  pageSize: z.enum(['Letter', 'A4']).default('Letter'),
  headerText: z.string().max(500).nullish(),
  footerText: z.string().max(500).nullish(),
})

const documentPatch = documentCreate.partial().extend({
  requiredForRoleKeys: z.array(z.string().trim().min(1).max(120)).optional(),
  requiredForTradeIds: z.array(uuid).optional(),
  printHeader: z.boolean().optional(),
  printFooter: z.boolean().optional(),
  pageSize: z.enum(['Letter', 'A4']).optional(),
  status: z.enum(documentStatus.enumValues).optional(),
})

function slugifyDocumentKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

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
    category: row.category,
    type_id: row.typeId,
    category_id: row.categoryId,
    status: row.status,
    owner_tenant_user_id: row.ownerTenantUserId,
    review_frequency_months: row.reviewFrequencyMonths,
    next_review_on: row.nextReviewOn,
    required_for_role_keys: row.requiredForRoleKeys,
    required_for_trade_ids: row.requiredForTradeIds,
    print_header: row.printHeader,
    print_footer: row.printFooter,
    page_size: row.pageSize,
    header_text: row.headerText,
    footer_text: row.footerText,
  }
}

async function createDocument(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = documentCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data
  const key = slugifyDocumentKey(b.key || b.title) || `document-${randomBytes(4).toString('hex')}`

  const row = await ctx.db(async (tx) => {
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
        category: stripEmpty(b.category),
        typeId: b.typeId ?? null,
        categoryId: b.categoryId ?? null,
        status: 'draft',
        ownerTenantUserId: b.ownerTenantUserId ?? null,
        reviewFrequencyMonths: b.reviewFrequencyMonths ?? null,
        nextReviewOn: optionalDate(b.nextReviewOn),
        requiredForRoleKeys: b.requiredForRoleKeys,
        requiredForTradeIds: b.requiredForTradeIds,
        printHeader: b.printHeader,
        printFooter: b.printFooter,
        pageSize: b.pageSize,
        headerText: stripEmpty(b.headerText),
        footerText: stripEmpty(b.footerText),
      })
      .returning()
    if (!created) return null
    await tx.insert(documentDrafts).values({
      tenantId: ctx.tenantId,
      documentId: created.id,
      contentHtml: '',
      contentJson: null,
      updatedByTenantUserId: safeTenantUserId(ctx),
    })
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create document')
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: row.id,
    action: 'create',
    summary: `Created document ${row.key}: ${row.title}`,
    after: {
      key: row.key,
      title: row.title,
      status: row.status,
      typeId: row.typeId,
      categoryId: row.categoryId,
    },
  })
  revalidatePath('/documents')
  return documentResult(row)
}

async function updateDocument(ctx: RequestContext, id: string, raw: unknown): Promise<WriteResult> {
  const parsed = documentPatch.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const result = await ctx.db(async (tx) => {
    const [before] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No documents with id ${id}`)

    await ensureDocumentType(tx, b.typeId)
    await ensureDocumentCategory(tx, b.categoryId)
    await ensureTenantUser(tx, b.ownerTenantUserId, 'document owner')

    const patch: Partial<typeof documents.$inferInsert> = {}
    if (hasOwn(b, 'title')) patch.title = b.title
    if (hasOwn(b, 'key')) {
      const key = slugifyDocumentKey(b.key ?? '')
      if (key) patch.key = key
    }
    if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
    if (hasOwn(b, 'category')) patch.category = stripEmpty(b.category)
    if (hasOwn(b, 'typeId')) patch.typeId = b.typeId ?? null
    if (hasOwn(b, 'categoryId')) patch.categoryId = b.categoryId ?? null
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'ownerTenantUserId')) patch.ownerTenantUserId = b.ownerTenantUserId ?? null
    if (hasOwn(b, 'reviewFrequencyMonths')) {
      patch.reviewFrequencyMonths = b.reviewFrequencyMonths ?? null
    }
    if (hasOwn(b, 'nextReviewOn')) patch.nextReviewOn = optionalDate(b.nextReviewOn)
    if (hasOwn(b, 'requiredForRoleKeys')) patch.requiredForRoleKeys = b.requiredForRoleKeys ?? []
    if (hasOwn(b, 'requiredForTradeIds')) patch.requiredForTradeIds = b.requiredForTradeIds ?? []
    if (hasOwn(b, 'printHeader')) patch.printHeader = b.printHeader
    if (hasOwn(b, 'printFooter')) patch.printFooter = b.printFooter
    if (hasOwn(b, 'pageSize')) patch.pageSize = b.pageSize
    if (hasOwn(b, 'headerText')) patch.headerText = stripEmpty(b.headerText)
    if (hasOwn(b, 'footerText')) patch.footerText = stripEmpty(b.footerText)
    assertPatchNotEmpty(patch)

    const [updated] = await tx.update(documents).set(patch).where(eq(documents.id, id)).returning()
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update document')
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: result.updated.status === 'published' ? 'publish' : 'update',
    summary: `Updated document ${result.updated.key}: ${result.updated.title}`,
    before: {
      key: result.before.key,
      title: result.before.title,
      status: result.before.status,
    },
    after: {
      key: result.updated.key,
      title: result.updated.title,
      status: result.updated.status,
    },
  })
  revalidatePath('/documents')
  revalidatePath(`/documents/${id}`)
  return documentResult(result.updated)
}

async function deleteDocument(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No documents with id ${id}`)
    const deletedAt = new Date()
    await tx.update(documents).set({ deletedAt }).where(eq(documents.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'delete',
    summary: `Archived document ${result.before.key}: ${result.before.title}`,
    before: {
      key: result.before.key,
      title: result.before.title,
      status: result.before.status,
    },
    after: { deletedAt: result.deletedAt },
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
    category: { type: 'string', description: 'Legacy/freeform category label.' },
    typeId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    ownerTenantUserId: { type: 'string', format: 'uuid' },
    reviewFrequencyMonths: { type: 'integer', minimum: 1, maximum: 120 },
    nextReviewOn: { type: 'string', format: 'date' },
    requiredForRoleKeys: { type: 'array', items: { type: 'string' } },
    requiredForTradeIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    printHeader: { type: 'boolean', default: true },
    printFooter: { type: 'boolean', default: true },
    pageSize: { type: 'string', enum: ['Letter', 'A4'], default: 'Letter' },
    headerText: { type: 'string' },
    footerText: { type: 'string' },
  },
}

const DOCUMENT_PATCH_BODY: Json = {
  ...optionalObjectSchema(DOCUMENT_BODY),
  properties: {
    ...(DOCUMENT_BODY.properties as Json),
    status: {
      type: 'string',
      enum: documentStatus.enumValues,
      description:
        'Metadata lifecycle status only. Publishing document content still runs through the editor/version workflow.',
    },
  },
}

// --- equipment ---------------------------------------------------------------

const equipmentCreate = z.object({
  assetTag: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  typeId: uuid.nullish(),
  categoryId: uuid.nullish(),
  serialNumber: z.string().max(200).nullish(),
  description: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
  status: z.enum(equipmentStatus.enumValues).default('in_service'),
  purchaseDate: isoDate.nullish(),
  warrantyExpiresOn: isoDate.nullish(),
  currentSiteOrgUnitId: uuid.nullish(),
  currentHolderPersonId: uuid.nullish(),
  requiresPreUseInspection: z.boolean().default(false),
  requiresAnnualInspection: z.boolean().default(false),
  nextAnnualInspectionDue: isoDate.nullish(),
  requiresOilChange: z.boolean().default(false),
  oilChangeIntervalMonths: z.number().int().positive().nullish(),
  lastOilChangeOn: isoDate.nullish(),
  nextOilChangeDue: isoDate.nullish(),
  metadata,
})

async function createEquipment(ctx: RequestContext, raw: unknown): Promise<WriteResult> {
  const parsed = equipmentCreate.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const b = parsed.data

  const row = await ctx.db(async (tx) => {
    if (b.typeId) {
      const [type] = await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, b.typeId))
        .limit(1)
      if (!type) throw ApiError.invalid(`No equipment type with id ${b.typeId} in this tenant`)
    }
    if (b.categoryId) {
      const [category] = await tx
        .select({ id: equipmentCategories.id })
        .from(equipmentCategories)
        .where(eq(equipmentCategories.id, b.categoryId))
        .limit(1)
      if (!category) {
        throw ApiError.invalid(`No equipment category with id ${b.categoryId} in this tenant`)
      }
    }
    await ensureSite(tx, b.currentSiteOrgUnitId)
    await ensurePerson(tx, b.currentHolderPersonId, 'holder')

    const [existing] = await tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(eq(equipmentItems.assetTag, b.assetTag))
      .limit(1)
    if (existing) throw ApiError.invalid(`Equipment asset tag "${b.assetTag}" already exists`)

    const [created] = await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        assetTag: b.assetTag,
        name: b.name,
        typeId: b.typeId ?? null,
        categoryId: b.categoryId ?? null,
        serialNumber: stripEmpty(b.serialNumber),
        description: stripEmpty(b.description),
        notes: stripEmpty(b.notes),
        qrToken: randomBytes(12).toString('base64url'),
        status: b.status,
        purchaseDate: optionalDate(b.purchaseDate),
        warrantyExpiresOn: optionalDate(b.warrantyExpiresOn),
        currentSiteOrgUnitId: b.currentSiteOrgUnitId ?? null,
        currentHolderPersonId: b.currentHolderPersonId ?? null,
        requiresPreUseInspection: b.requiresPreUseInspection,
        requiresAnnualInspection: b.requiresAnnualInspection,
        nextAnnualInspectionDue: optionalDate(b.nextAnnualInspectionDue),
        requiresOilChange: b.requiresOilChange,
        oilChangeIntervalMonths: b.oilChangeIntervalMonths ?? null,
        lastOilChangeOn: optionalDate(b.lastOilChangeOn),
        nextOilChangeDue: optionalDate(b.nextOilChangeDue),
        isAvailableForCheckout: !b.currentHolderPersonId && b.status === 'in_service',
        metadata: b.metadata,
      })
      .returning()
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create equipment item')
  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: row.id,
    action: 'create',
    summary: `Created equipment ${row.assetTag}: ${row.name}`,
    after: {
      assetTag: row.assetTag,
      name: row.name,
      status: row.status,
      currentSiteOrgUnitId: row.currentSiteOrgUnitId,
    },
  })
  revalidatePath('/equipment')

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
    next_annual_inspection_due: row.nextAnnualInspectionDue,
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
    if (!before || before.deletedAt) throw ApiError.notFound(`No equipment with id ${id}`)

    if (b.typeId) {
      const [type] = await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, b.typeId))
        .limit(1)
      if (!type) throw ApiError.invalid(`No equipment type with id ${b.typeId} in this tenant`)
    }
    if (b.categoryId) {
      const [category] = await tx
        .select({ id: equipmentCategories.id })
        .from(equipmentCategories)
        .where(eq(equipmentCategories.id, b.categoryId))
        .limit(1)
      if (!category) {
        throw ApiError.invalid(`No equipment category with id ${b.categoryId} in this tenant`)
      }
    }
    await ensureSite(tx, b.currentSiteOrgUnitId)
    await ensurePerson(tx, b.currentHolderPersonId, 'holder')

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
    if (hasOwn(b, 'description')) patch.description = stripEmpty(b.description)
    if (hasOwn(b, 'notes')) patch.notes = stripEmpty(b.notes)
    if (hasOwn(b, 'status')) patch.status = b.status
    if (hasOwn(b, 'purchaseDate')) patch.purchaseDate = optionalDate(b.purchaseDate)
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
    if (hasOwn(b, 'requiresAnnualInspection')) {
      patch.requiresAnnualInspection = b.requiresAnnualInspection
    }
    if (hasOwn(b, 'nextAnnualInspectionDue')) {
      patch.nextAnnualInspectionDue = optionalDate(b.nextAnnualInspectionDue)
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
    const nextStatus = hasOwn(b, 'status') ? b.status : before.status
    if (hasOwn(b, 'currentHolderPersonId') || hasOwn(b, 'status')) {
      patch.isAvailableForCheckout = !nextHolder && nextStatus === 'in_service'
    }
    assertPatchNotEmpty(patch)

    const [updated] = await tx
      .update(equipmentItems)
      .set(patch)
      .where(eq(equipmentItems.id, id))
      .returning()

    const nextSite = hasOwn(b, 'currentSiteOrgUnitId')
      ? (b.currentSiteOrgUnitId ?? null)
      : before.currentSiteOrgUnitId
    if (nextSite !== before.currentSiteOrgUnitId || nextHolder !== before.currentHolderPersonId) {
      await tx.insert(equipmentLocationHistory).values({
        tenantId: ctx.tenantId,
        itemId: id,
        siteOrgUnitId: nextSite,
        holderPersonId: nextHolder,
        recordedByTenantUserId: safeTenantUserId(ctx),
        note: 'Updated via public API',
      })
    }

    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update equipment item')
  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: id,
    action: 'update',
    summary: `Updated equipment ${result.updated.assetTag}: ${result.updated.name}`,
    before: {
      assetTag: result.before.assetTag,
      name: result.before.name,
      status: result.before.status,
      currentSiteOrgUnitId: result.before.currentSiteOrgUnitId,
      currentHolderPersonId: result.before.currentHolderPersonId,
    },
    after: {
      assetTag: result.updated.assetTag,
      name: result.updated.name,
      status: result.updated.status,
      currentSiteOrgUnitId: result.updated.currentSiteOrgUnitId,
      currentHolderPersonId: result.updated.currentHolderPersonId,
    },
  })
  revalidatePath('/equipment')
  revalidatePath(`/equipment/${id}`)
  return equipmentResult(result.updated)
}

async function deleteEquipment(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(equipmentItems)
      .where(eq(equipmentItems.id, id))
      .limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No equipment with id ${id}`)
    const deletedAt = new Date()
    await tx.update(equipmentItems).set({ deletedAt }).where(eq(equipmentItems.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: id,
    action: 'delete',
    summary: `Archived equipment ${result.before.assetTag}: ${result.before.name}`,
    before: {
      assetTag: result.before.assetTag,
      name: result.before.name,
      status: result.before.status,
    },
    after: { deletedAt: result.deletedAt },
  })
  revalidatePath('/equipment')
  revalidatePath(`/equipment/${id}`)
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
    description: { type: 'string' },
    notes: { type: 'string' },
    status: { type: 'string', enum: equipmentStatus.enumValues, default: 'in_service' },
    purchaseDate: { type: 'string', format: 'date' },
    warrantyExpiresOn: { type: 'string', format: 'date' },
    currentSiteOrgUnitId: { type: 'string', format: 'uuid' },
    currentHolderPersonId: { type: 'string', format: 'uuid' },
    requiresPreUseInspection: { type: 'boolean', default: false },
    requiresAnnualInspection: { type: 'boolean', default: false },
    nextAnnualInspectionDue: { type: 'string', format: 'date' },
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
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create PPE item')
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: row.id,
    action: 'create',
    summary: `Added PPE item${row.serialNumber ? ` ${row.serialNumber}` : ''}`,
    after: {
      typeId: row.typeId,
      serialNumber: row.serialNumber,
      status: row.status,
      currentHolderPersonId: row.currentHolderPersonId,
    },
  })
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
    const [before] = await tx.select().from(ppeItems).where(eq(ppeItems.id, id)).limit(1)
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
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update PPE item')
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: id,
    action: 'update',
    summary: `Updated PPE item${result.updated.serialNumber ? ` ${result.updated.serialNumber}` : ''}`,
    before: {
      typeId: result.before.typeId,
      serialNumber: result.before.serialNumber,
      status: result.before.status,
      currentHolderPersonId: result.before.currentHolderPersonId,
    },
    after: {
      typeId: result.updated.typeId,
      serialNumber: result.updated.serialNumber,
      status: result.updated.status,
      currentHolderPersonId: result.updated.currentHolderPersonId,
    },
  })
  revalidatePath('/ppe')
  revalidatePath(`/ppe/${id}`)
  return ppeResult(result.updated)
}

async function deletePpe(ctx: RequestContext, id: string): Promise<WriteResult> {
  const result = await ctx.db(async (tx) => {
    const [before] = await tx.select().from(ppeItems).where(eq(ppeItems.id, id)).limit(1)
    if (!before || before.deletedAt) throw ApiError.notFound(`No ppe with id ${id}`)
    const deletedAt = new Date()
    await tx.update(ppeItems).set({ deletedAt }).where(eq(ppeItems.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: id,
    action: 'delete',
    summary: `Archived PPE item${result.before.serialNumber ? ` ${result.before.serialNumber}` : ''}`,
    before: {
      typeId: result.before.typeId,
      serialNumber: result.before.serialNumber,
      status: result.before.status,
    },
    after: { deletedAt: result.deletedAt },
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
    return created
  })

  if (!row) throw new ApiError(500, 'internal', 'Failed to create training record')
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: row.id,
    action: 'create',
    summary: 'Created training record via API',
    after: {
      personId: row.personId,
      courseId: row.courseId,
      source: row.source,
      completedOn: row.completedOn,
    },
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
    return { before, updated }
  })

  if (!result.updated) throw new ApiError(500, 'internal', 'Failed to update training record')
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: id,
    action: 'update',
    summary: 'Updated training record via API',
    before: {
      personId: result.before.personId,
      courseId: result.before.courseId,
      completedOn: result.before.completedOn,
      expiresOn: result.before.expiresOn,
    },
    after: {
      personId: result.updated.personId,
      courseId: result.updated.courseId,
      completedOn: result.updated.completedOn,
      expiresOn: result.updated.expiresOn,
    },
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
      .limit(1)
    if (!before || before.deletedAt) {
      throw ApiError.notFound(`No training_records with id ${id}`)
    }
    const deletedAt = new Date()
    await tx.update(trainingRecords).set({ deletedAt }).where(eq(trainingRecords.id, id))
    return { before, deletedAt }
  })
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: id,
    action: 'delete',
    summary: 'Revoked training record via API',
    before: {
      personId: result.before.personId,
      courseId: result.before.courseId,
      completedOn: result.before.completedOn,
      expiresOn: result.before.expiresOn,
    },
    after: { deletedAt: result.deletedAt },
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

/** Entity keys that accept POST creates — the single source of truth. */
export const WRITABLE_ENTITY_KEYS = Object.keys(WRITES)

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
