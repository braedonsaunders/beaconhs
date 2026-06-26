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
  correctiveActionSource,
  correctiveActions,
  departments,
  equipmentCategories,
  equipmentItems,
  equipmentStatus,
  equipmentTypes,
  incidents,
  incidentSeverity,
  incidentType,
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
import { ApiError } from './errors'

type Json = Record<string, unknown>
export type WriteResult = { id: string; [k: string]: unknown }
type WriteHandler = (ctx: RequestContext, body: unknown) => Promise<WriteResult>
type TenantTx = Parameters<Parameters<RequestContext['db']>[0]>[0]
type WriteRegistration = {
  permission: string
  handler: WriteHandler
  bodySchema: Json
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

function safeTenantUserId(ctx: RequestContext): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
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

  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    occurredAt: row.occurredAt.toISOString(),
    siteOrgUnitId: row.siteOrgUnitId,
  }
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

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    severity: row.severity,
    status: row.status,
    source: row.source,
    assignedOn: row.assignedOn,
    dueOn: row.dueOn,
    siteOrgUnitId: row.siteOrgUnitId,
  }
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

  return {
    id: row.id,
    assetTag: row.assetTag,
    name: row.name,
    serialNumber: row.serialNumber,
    status: row.status,
    currentSiteOrgUnitId: row.currentSiteOrgUnitId,
    currentHolderPersonId: row.currentHolderPersonId,
  }
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

  return {
    id: row.id,
    typeId: row.typeId,
    serialNumber: row.serialNumber,
    size: row.size,
    status: row.status,
    currentHolderPersonId: row.currentHolderPersonId,
  }
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

  return {
    id: row.id,
    personId: row.personId,
    courseId: row.courseId,
    source: row.source,
    completedOn: row.completedOn,
    expiresOn: row.expiresOn ?? null,
    score: row.score ?? null,
    grade: row.grade ?? null,
  }
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

// --- registry ----------------------------------------------------------------

const WRITES: Record<string, WriteRegistration> = {
  incidents: {
    permission: 'incidents.create',
    handler: createIncident,
    bodySchema: INCIDENT_BODY,
  },
  corrective_actions: {
    permission: 'ca.create',
    handler: createCorrectiveAction,
    bodySchema: CORRECTIVE_ACTION_BODY,
  },
  equipment: {
    permission: 'equipment.manage',
    handler: createEquipment,
    bodySchema: EQUIPMENT_BODY,
  },
  ppe: {
    permission: 'ppe.manage',
    handler: createPpe,
    bodySchema: PPE_BODY,
  },
  training_records: {
    permission: 'training.record.create',
    handler: createTrainingRecord,
    bodySchema: TRAINING_RECORD_BODY,
  },
}

/** Entity keys that accept POST creates — the single source of truth. */
export const WRITABLE_ENTITY_KEYS = Object.keys(WRITES)

export function isWritable(entityKey: string): boolean {
  return entityKey in WRITES
}

/** OpenAPI requestBody schema for a writable entity, or null. */
export function writeBodySchema(entityKey: string): Json | null {
  return WRITES[entityKey]?.bodySchema ?? null
}

/** Permission required to POST-create this entity. */
export function writePermissionForEntity(entityKey: string): string | null {
  return WRITES[entityKey]?.permission ?? null
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
