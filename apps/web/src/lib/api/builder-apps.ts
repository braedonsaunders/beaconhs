import 'server-only'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  isFormResponseParentLockedError,
  lockFormResponseForMutation,
  type Database,
} from '@beaconhs/db'
import {
  formResponseScores,
  formResponses,
  formResponseStatus,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  type FormField,
  type FormSchemaV1,
} from '@beaconhs/db/schema'
import { extractScores, normalizeFormResponseData, validateResponse } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { recordAudit } from '@/lib/audit'
import { submitFormResponseLifecycle } from '@/lib/forms/form-response-lifecycle'
import { materializeFormResponseEvidenceChange } from '@/lib/forms/form-response-evidence'
import { ApiError } from './errors'
import { isUuid } from './records'

export const BUILDER_APP_READ_PERMISSION = 'forms.response.read.all'
export const BUILDER_APP_CREATE_PERMISSION = 'forms.response.create'
export const BUILDER_APP_UPDATE_PERMISSION = 'forms.response.update.own'
export const BUILDER_APP_DELETE_PERMISSION = 'forms.response.delete'

type BuilderAppFieldSummary = {
  id: string
  label: string
  type: string
  section_id: string
  section_label: string | null
  required: boolean
  repeating: boolean
}

export type BuilderAppOpenApiEntity = {
  id: string
  key: string
  name: string
  description: string | null
  category: string | null
  kind: string
  version: number
  schema: FormSchemaV1
}

type BuilderAppSummary = BuilderAppOpenApiEntity & {
  fields: BuilderAppFieldSummary[]
  endpoint: string
  responses_endpoint: string
}

type BuilderAppResponse = {
  id: string
  template_id: string
  template_key: string
  template_name: string
  template_version_id: string
  template_version: number
  status: string
  site_org_unit_id: string | null
  subject_person_id: string | null
  submitted_by: string | null
  submitted_at: string | null
  closed_at: string | null
  locked: boolean
  compliance_score: number | null
  compliance_status: string | null
  monitor_status: string | null
  created_at: string
  updated_at: string
  data: Record<string, unknown>
}

type BuilderAppResponsePage = {
  data: BuilderAppResponse[]
  pagination: { limit: number; offset: number; total: number; hasMore: boolean }
}

const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 50

async function lockApiResponseForMutation(tx: Database, ctx: RequestContext, responseId: string) {
  try {
    return await lockFormResponseForMutation(tx, ctx.tenantId, responseId)
  } catch (error) {
    if (isFormResponseParentLockedError(error)) throw ApiError.invalid(error.message)
    throw error
  }
}

const uuid = z.string().refine(isUuid, { message: 'Expected a uuid' })
const responseData = z.record(z.string(), z.unknown())
const createBody = z
  .object({
    data: responseData,
    siteOrgUnitId: uuid.nullish(),
    subjectPersonId: uuid.nullish(),
    responseId: uuid.nullish(),
  })
  .strict()
const patchBody = z
  .object({
    data: responseData.optional(),
    fields: responseData.optional(),
    siteOrgUnitId: uuid.nullish(),
    subjectPersonId: uuid.nullish(),
  })
  .strict()
  .refine(
    (value) =>
      typeof value.data !== 'undefined' ||
      typeof value.fields !== 'undefined' ||
      typeof value.siteOrgUnitId !== 'undefined' ||
      typeof value.subjectPersonId !== 'undefined',
    { message: 'At least one of data, fields, siteOrgUnitId or subjectPersonId is required' },
  )

function validationError(error: z.ZodError): ApiError {
  return ApiError.invalid(
    'Validation failed',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  )
}

function labelText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object') {
    const i18n = value as Record<string, unknown>
    if (typeof i18n.en === 'string' && i18n.en.trim()) return i18n.en
    for (const candidate of Object.values(i18n)) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  }
  return fallback
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function numberOrNull(value: unknown): number | null {
  if (value === null || typeof value === 'undefined') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function parseDateParam(name: string, value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw ApiError.invalid(`${name} must be a date or date-time`)
  return date
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function schemaFieldSummaries(schema: FormSchemaV1): BuilderAppFieldSummary[] {
  const fields: BuilderAppFieldSummary[] = []
  for (const section of schema.sections) {
    const sectionLabel = section.title ? labelText(section.title, section.id) : null
    for (const field of section.fields) {
      fields.push({
        id: field.id,
        label: labelText(field.label, field.id),
        type: field.type,
        section_id: section.id,
        section_label: sectionLabel,
        required: Boolean(field.required || field.validation?.required),
        repeating: Boolean(section.repeating),
      })
    }
  }
  return fields
}

function allowedDataKeys(schema: FormSchemaV1): Set<string> {
  const allowed = new Set<string>()
  for (const section of schema.sections) {
    if (section.repeating) {
      allowed.add(section.id)
      continue
    }
    for (const field of section.fields) allowed.add(field.id)
  }
  return allowed
}

function assertKnownDataKeys(schema: FormSchemaV1, data: Record<string, unknown>): void {
  const allowed = allowedDataKeys(schema)
  const unknown = Object.keys(data).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw ApiError.invalid(
      `Unknown response field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    )
  }
}

function repeatingRows(
  schema: FormSchemaV1,
  data: Record<string, unknown>,
): Record<string, Array<Record<string, unknown>>> {
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const value = data[section.id]
    rows[section.id] = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
  }
  return rows
}

function appSummary(app: BuilderAppOpenApiEntity): BuilderAppSummary {
  return {
    ...app,
    fields: schemaFieldSummaries(app.schema),
    endpoint: `/api/v1/apps/${encodeURIComponent(app.key)}`,
    responses_endpoint: `/api/v1/apps/${encodeURIComponent(app.key)}/responses`,
  }
}

function formatResponse(
  row: typeof formResponses.$inferSelect,
  app: Pick<BuilderAppOpenApiEntity, 'id' | 'key' | 'name' | 'version' | 'schema'>,
  versionId = row.templateVersionId,
): BuilderAppResponse {
  return {
    id: row.id,
    template_id: app.id,
    template_key: app.key,
    template_name: app.name,
    template_version_id: versionId,
    template_version: app.version,
    status: row.status,
    site_org_unit_id: row.siteOrgUnitId,
    subject_person_id: row.subjectPersonId,
    submitted_by: row.submittedBy,
    submitted_at: iso(row.submittedAt),
    closed_at: iso(row.closedAt),
    locked: row.locked,
    compliance_score: numberOrNull(row.complianceScore),
    compliance_status: row.complianceStatus,
    monitor_status: row.monitorStatus,
    created_at: iso(row.createdAt) ?? new Date(0).toISOString(),
    updated_at: iso(row.updatedAt) ?? new Date(0).toISOString(),
    data: normalizeFormResponseData(app.schema, (row.data ?? {}) as Record<string, unknown>),
  }
}

async function ensureSite(ctx: RequestContext, id: string | null | undefined): Promise<void> {
  if (!id) return
  await ctx.db(async (tx) => {
    const [site] = await tx
      .select({ id: orgUnits.id, level: orgUnits.level })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
      .limit(1)
    if (!site) throw ApiError.invalid(`No org unit with id ${id} in this tenant`)
    if (site.level !== 'site') throw ApiError.invalid(`Org unit ${id} is not a site`)
  })
}

async function ensurePerson(ctx: RequestContext, id: string | null | undefined): Promise<void> {
  if (!id) return
  await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, id), isNull(people.deletedAt)))
      .limit(1)
    if (!person) throw ApiError.invalid(`No person with id ${id} in this tenant`)
  })
}

export async function resolveBuilderApp(
  ctx: RequestContext,
  templateKeyOrId: string,
  grantedTemplateIds: readonly string[],
): Promise<BuilderAppOpenApiEntity> {
  const lookup = decodeURIComponent(templateKeyOrId).trim()
  if (!lookup) throw ApiError.notFound('Builder app not found')
  if (grantedTemplateIds.length === 0) throw ApiError.notFound('Builder app not found')

  return ctx.db(async (tx) => {
    const [template] = await tx
      .select({
        id: formTemplates.id,
        key: formTemplates.key,
        name: formTemplates.name,
        description: formTemplates.description,
        category: formTemplates.category,
        kind: formTemplates.kind,
      })
      .from(formTemplates)
      .where(
        and(
          eq(formTemplates.tenantId, ctx.tenantId),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
          inArray(formTemplates.id, [...grantedTemplateIds]),
          isUuid(lookup)
            ? or(eq(formTemplates.id, lookup), eq(formTemplates.key, lookup))
            : eq(formTemplates.key, lookup),
        ),
      )
      .limit(1)
    if (!template) throw ApiError.notFound(`No published Builder app "${lookup}"`)

    const [version] = await tx
      .select({
        id: formTemplateVersions.id,
        version: formTemplateVersions.version,
        schema: formTemplateVersions.schema,
      })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, template.id))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) throw ApiError.notFound(`Builder app "${template.key}" has no published schema`)

    return {
      id: template.id,
      key: template.key,
      name: template.name,
      description: template.description,
      category: template.category,
      kind: template.kind,
      version: version.version,
      schema: version.schema,
    }
  })
}

export async function listBuilderApps(
  ctx: RequestContext,
  grantedTemplateIds: readonly string[],
): Promise<BuilderAppSummary[]> {
  if (grantedTemplateIds.length === 0) return []
  const rows = await ctx.db(async (tx) => {
    const templates = await tx
      .select({
        id: formTemplates.id,
        key: formTemplates.key,
        name: formTemplates.name,
        description: formTemplates.description,
        category: formTemplates.category,
        kind: formTemplates.kind,
      })
      .from(formTemplates)
      .where(
        and(
          eq(formTemplates.tenantId, ctx.tenantId),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
          inArray(formTemplates.id, [...grantedTemplateIds]),
        ),
      )
      .orderBy(asc(formTemplates.name))

    if (templates.length === 0) return []

    // Latest version per template in one round-trip (DISTINCT ON), instead of
    // one query per published app.
    const versions = await tx
      .selectDistinctOn([formTemplateVersions.templateId], {
        templateId: formTemplateVersions.templateId,
        version: formTemplateVersions.version,
        schema: formTemplateVersions.schema,
      })
      .from(formTemplateVersions)
      .where(
        inArray(
          formTemplateVersions.templateId,
          templates.map((t) => t.id),
        ),
      )
      .orderBy(asc(formTemplateVersions.templateId), desc(formTemplateVersions.version))
    const latestByTemplate = new Map(versions.map((v) => [v.templateId, v]))

    const apps: BuilderAppOpenApiEntity[] = []
    for (const template of templates) {
      const version = latestByTemplate.get(template.id)
      if (!version) continue
      apps.push({
        ...template,
        version: version.version,
        schema: version.schema,
      })
    }
    return apps
  })

  return rows.map(appSummary)
}

export async function listBuilderAppOpenApiEntities(
  ctx: RequestContext,
  grantedTemplateIds: readonly string[],
): Promise<BuilderAppOpenApiEntity[]> {
  return (await listBuilderApps(ctx, grantedTemplateIds)).map(
    ({ fields, endpoint, responses_endpoint, ...app }) => app,
  )
}

function dataFilterParams(schema: FormSchemaV1, params: URLSearchParams): SQL[] {
  const allowed = allowedDataKeys(schema)
  const filters: SQL[] = []
  for (const [name, value] of params.entries()) {
    if (!name.startsWith('data.')) continue
    const fieldId = name.slice('data.'.length)
    if (!allowed.has(fieldId)) {
      throw ApiError.invalid(`Unknown data field "${fieldId}"`)
    }
    filters.push(sql`${formResponses.data}->>${fieldId} = ${value}`)
  }
  return filters
}

export async function listBuilderAppResponses(
  ctx: RequestContext,
  app: BuilderAppOpenApiEntity,
  params: URLSearchParams,
): Promise<BuilderAppResponsePage> {
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = clampInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const status = params.get('status')
  if (status && !formResponseStatus.enumValues.includes(status as never)) {
    throw ApiError.invalid(`Unknown response status "${status}"`)
  }
  const submittedGte = parseDateParam('submitted_at__gte', params.get('submitted_at__gte'))
  const submittedLte = parseDateParam('submitted_at__lte', params.get('submitted_at__lte'))
  const createdGte = parseDateParam('created_at__gte', params.get('created_at__gte'))
  const createdLte = parseDateParam('created_at__lte', params.get('created_at__lte'))
  const siteOrgUnitId = params.get('site_org_unit_id')
  const subjectPersonId = params.get('subject_person_id')
  if (siteOrgUnitId && !isUuid(siteOrgUnitId)) {
    throw ApiError.invalid('site_org_unit_id must be a uuid')
  }
  if (subjectPersonId && !isUuid(subjectPersonId)) {
    throw ApiError.invalid('subject_person_id must be a uuid')
  }

  const filters: SQL[] = [
    eq(formResponses.templateId, app.id),
    isNull(formResponses.deletedAt),
    ...dataFilterParams(app.schema, params),
  ]
  if (status)
    filters.push(eq(formResponses.status, status as (typeof formResponseStatus.enumValues)[number]))
  if (submittedGte) filters.push(gte(formResponses.submittedAt, submittedGte))
  if (submittedLte) filters.push(lte(formResponses.submittedAt, submittedLte))
  if (createdGte) filters.push(gte(formResponses.createdAt, createdGte))
  if (createdLte) filters.push(lte(formResponses.createdAt, createdLte))
  if (siteOrgUnitId) filters.push(eq(formResponses.siteOrgUnitId, siteOrgUnitId))
  if (subjectPersonId) filters.push(eq(formResponses.subjectPersonId, subjectPersonId))

  const sort = params.get('sort') ?? 'submitted_at'
  const order = params.get('order') === 'asc' ? 'asc' : 'desc'
  const sortColumn =
    sort === 'created_at'
      ? formResponses.createdAt
      : sort === 'updated_at'
        ? formResponses.updatedAt
        : sort === 'status'
          ? formResponses.status
          : sort === 'compliance_score'
            ? formResponses.complianceScore
            : sort === 'submitted_at'
              ? formResponses.submittedAt
              : null
  if (!sortColumn) {
    throw ApiError.invalid(
      'sort must be one of submitted_at, created_at, updated_at, status, compliance_score',
    )
  }

  return ctx.db(async (tx) => {
    const where = and(...filters)
    const rows = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
        version: formTemplateVersions.version,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(where)
      .orderBy(order === 'asc' ? asc(sortColumn) : desc(sortColumn))
      .limit(limit)
      .offset(offset)
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(formResponses)
      .where(where)
    const data = rows.map((row) =>
      formatResponse(row.response, { ...app, schema: row.schema, version: row.version }),
    )
    return {
      data,
      pagination: {
        limit,
        offset,
        total: Number(total ?? 0),
        hasMore: offset + data.length < Number(total ?? 0),
      },
    }
  })
}

export async function getBuilderAppResponse(
  ctx: RequestContext,
  app: BuilderAppOpenApiEntity,
  id: string,
): Promise<BuilderAppResponse | null> {
  if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
        version: formTemplateVersions.version,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(
        and(
          eq(formResponses.id, id),
          eq(formResponses.templateId, app.id),
          isNull(formResponses.deletedAt),
        ),
      )
      .limit(1)
    return row
      ? formatResponse(row.response, { ...app, schema: row.schema, version: row.version })
      : null
  })
}

export async function createBuilderAppResponse(
  ctx: RequestContext,
  app: BuilderAppOpenApiEntity,
  raw: unknown,
): Promise<BuilderAppResponse> {
  const parsed = createBody.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const body = parsed.data
  assertKnownDataKeys(app.schema, body.data)
  await ensureSite(ctx, body.siteOrgUnitId)
  await ensurePerson(ctx, body.subjectPersonId)

  let result: Awaited<ReturnType<typeof submitFormResponseLifecycle>>
  try {
    result = await submitFormResponseLifecycle(ctx, {
      templateId: app.id,
      data: body.data,
      siteOrgUnitId: body.siteOrgUnitId,
      subjectPersonId: body.subjectPersonId,
      responseId: body.responseId,
    })
  } catch (error) {
    if (isFormResponseParentLockedError(error)) throw ApiError.invalid(error.message)
    throw error
  }
  if (!result.ok) throw ApiError.invalid('Validation failed', result.errors)

  revalidatePath('/apps/responses')
  revalidatePath(`/apps/responses/${result.responseId}`)
  const response = await getBuilderAppResponse(ctx, app, result.responseId)
  if (!response) throw new ApiError(500, 'internal', 'Submitted response was not readable')
  return response
}

export async function updateBuilderAppResponse(
  ctx: RequestContext,
  app: BuilderAppOpenApiEntity,
  id: string,
  raw: unknown,
): Promise<BuilderAppResponse> {
  if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')
  const parsed = patchBody.safeParse(raw)
  if (!parsed.success) throw validationError(parsed.error)
  const body = parsed.data
  if (body.data) assertKnownDataKeys(app.schema, body.data)
  if (body.fields) assertKnownDataKeys(app.schema, body.fields)
  await ensureSite(ctx, body.siteOrgUnitId)
  await ensurePerson(ctx, body.subjectPersonId)

  const result = await ctx.db(async (tx) => {
    const mutable = await lockApiResponseForMutation(tx, ctx, id)
    if (!mutable || mutable.templateId !== app.id) {
      throw ApiError.notFound(`No response with id ${id}`)
    }
    const [row] = await tx
      .select({
        response: formResponses,
        schema: formTemplateVersions.schema,
        version: formTemplateVersions.version,
        category: formTemplates.category,
      })
      .from(formResponses)
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(
        and(
          eq(formResponses.id, id),
          eq(formResponses.templateId, app.id),
          isNull(formResponses.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw ApiError.notFound(`No response with id ${id}`)
    if (row.response.locked) throw ApiError.invalid('Response is locked and cannot be updated')

    const rawNextData = body.data
      ? body.data
      : { ...((row.response.data ?? {}) as Record<string, unknown>), ...(body.fields ?? {}) }
    assertKnownDataKeys(row.schema, rawNextData)
    const validationStage =
      row.response.status === 'draft' || row.response.status === 'in_progress' ? 'draft' : 'submit'
    const rawErrors = validateResponse(row.schema, rawNextData, validationStage)
    if (rawErrors.length > 0) throw ApiError.invalid('Validation failed', rawErrors)

    const nextData = normalizeFormResponseData(row.schema, rawNextData)
    const errors = validateResponse(row.schema, nextData, validationStage)
    if (errors.length > 0) throw ApiError.invalid('Validation failed', errors)

    const verdict = computeFormScore(row.schema, nextData, repeatingRows(row.schema, nextData))
    const patch: Partial<typeof formResponses.$inferInsert> = {
      data: nextData,
      complianceScore: String(verdict.score),
      complianceStatus: verdict.status,
    }
    if (row.response.status === 'draft') patch.status = 'in_progress'
    if (row.response.status === 'submitted' || row.response.status === 'non_compliant') {
      patch.status = verdict.status === 'non_compliant' ? 'non_compliant' : 'submitted'
    }
    if (hasOwn(body, 'siteOrgUnitId')) patch.siteOrgUnitId = body.siteOrgUnitId ?? null
    if (hasOwn(body, 'subjectPersonId')) patch.subjectPersonId = body.subjectPersonId ?? null

    const [updated] = await tx
      .update(formResponses)
      .set(patch)
      .where(eq(formResponses.id, id))
      .returning()
    if (!updated) throw new ApiError(500, 'internal', 'Failed to update response')
    await materializeFormResponseEvidenceChange(tx, ctx.tenantId, row.response, updated)

    await tx.delete(formResponseScores).where(eq(formResponseScores.responseId, id))
    const scores = extractScores(row.schema, nextData)
    if (scores.length > 0) {
      await tx.insert(formResponseScores).values(
        scores.map((score) => ({
          tenantId: ctx.tenantId,
          responseId: id,
          fieldId: score.fieldId,
          sectionId: score.sectionId,
          score: score.score,
          label: score.label,
          weight: score.weight,
        })),
      )
    }

    const [submitterPerson] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.userId, ctx.userId)))
      .limit(1)
    await repopulateParticipants(tx, {
      tenantId: ctx.tenantId,
      responseId: id,
      templateId: app.id,
      category: row.category,
      schema: row.schema,
      data: nextData,
      submittedAt: row.response.submittedAt ?? new Date(),
      submitterPersonId: submitterPerson?.id ?? null,
    })

    return { before: row.response, updated, version: row.version, schema: row.schema }
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: id,
    action: 'update',
    summary: `Updated ${app.name} response via API`,
    before: {
      status: result.before.status,
      complianceScore: result.before.complianceScore,
      complianceStatus: result.before.complianceStatus,
    },
    after: {
      status: result.updated.status,
      complianceScore: result.updated.complianceScore,
      complianceStatus: result.updated.complianceStatus,
    },
  })
  revalidatePath('/apps/responses')
  revalidatePath(`/apps/responses/${id}`)
  return formatResponse(result.updated, {
    ...app,
    version: result.version,
    schema: result.schema,
  })
}

export async function deleteBuilderAppResponse(
  ctx: RequestContext,
  app: BuilderAppOpenApiEntity,
  id: string,
): Promise<{ id: string; template_key: string; deleted: true; deleted_at: string }> {
  if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')
  const result = await ctx.db(async (tx) => {
    const before = await lockApiResponseForMutation(tx, ctx, id)
    if (!before || before.templateId !== app.id) {
      throw ApiError.notFound(`No response with id ${id}`)
    }
    if (before.locked) throw ApiError.invalid('Response is locked and cannot be archived')
    const deletedAt = new Date()
    const [archived] = await tx
      .update(formResponses)
      .set({ deletedAt })
      .where(eq(formResponses.id, id))
      .returning()
    if (!archived) throw new ApiError(500, 'internal', 'Failed to archive response')
    await materializeFormResponseEvidenceChange(tx, ctx.tenantId, before, archived)
    return { before, deletedAt: archived.deletedAt ?? deletedAt }
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: id,
    action: 'delete',
    summary: `Archived ${app.name} response via API`,
    before: {
      status: result.before.status,
      submittedAt: result.before.submittedAt,
      complianceStatus: result.before.complianceStatus,
    },
    after: { deletedAt: result.deletedAt },
  })
  revalidatePath('/apps/responses')
  revalidatePath(`/apps/responses/${id}`)
  return {
    id,
    template_key: app.key,
    deleted: true,
    deleted_at: result.deletedAt.toISOString(),
  }
}

function fieldOpenApiSchema(field: FormField): Record<string, unknown> {
  switch (field.type) {
    case 'number':
    case 'rating':
    case 'slider':
      return { type: 'number' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'datetime':
      return { type: 'string', format: 'date-time' }
    case 'multi_select':
    case 'checkbox_group':
    case 'photo':
    case 'photo_upload':
    case 'photo_ai':
    case 'photo_annotated':
    case 'file':
    case 'video':
    case 'audio':
      return { type: 'array', items: {} }
    case 'table':
      return { type: 'array', items: { type: 'object', additionalProperties: true } }
    case 'yes_no_comment':
      return {
        type: 'object',
        properties: {
          answer: { type: 'string', enum: ['yes', 'no', 'na'] },
          comment: { type: 'string' },
        },
      }
    case 'pass_fail_na':
      return { type: 'string', enum: ['pass', 'fail', 'n_a'] }
    default:
      return { type: 'string' }
  }
}

export function responseDataOpenApiSchema(schema: FormSchemaV1): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const section of schema.sections) {
    if (section.repeating) {
      const rowProperties: Record<string, unknown> = {}
      for (const field of section.fields) rowProperties[field.id] = fieldOpenApiSchema(field)
      properties[section.id] = {
        type: 'array',
        items: { type: 'object', properties: rowProperties, additionalProperties: false },
        description: section.title ? labelText(section.title, section.id) : section.id,
      }
      if (section.minRows && section.minRows > 0) required.push(section.id)
      continue
    }
    for (const field of section.fields) {
      properties[field.id] = {
        ...fieldOpenApiSchema(field),
        description: labelText(field.label, field.id),
      }
      if (field.required || field.validation?.required) required.push(field.id)
    }
  }
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  }
}
