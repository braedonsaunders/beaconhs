// Form participants — server-side write + read helpers around the
// form_response_participants table. The pure extraction lives in
// @beaconhs/forms-core; this owns persistence (delete+reinsert on submit) and
// the per-person transcript read used by the people page + /apps/transcripts.

import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { formResponseParticipants, formResponses, formTemplates, people } from '@beaconhs/db/schema'
import { extractParticipants, type FormSchemaV1 } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { templateAccessWhere } from './access'

/** First top-level `date` field value, else the submit date — as YYYY-MM-DD. */
function resolvePrimaryDate(
  schema: FormSchemaV1,
  data: Record<string, unknown>,
  fallback: Date,
): string {
  for (const section of schema.sections) {
    if (section.repeating) continue
    for (const field of section.fields) {
      if (field.type === 'date' || field.type === 'datetime') {
        const v = data[field.id]
        if (typeof v === 'string' && v.trim()) return v.slice(0, 10)
      }
    }
  }
  return fallback.toISOString().slice(0, 10)
}

/**
 * Rebuild the participant rows for a submitted response (delete + reinsert, so
 * it is idempotent on resubmit). Runs inside the submit transaction.
 */
export async function repopulateParticipants(
  tx: Database,
  args: {
    tenantId: string
    responseId: string
    templateId: string
    category: string | null
    schema: FormSchemaV1
    data: Record<string, unknown>
    submittedAt: Date
    /** The person who submitted — recorded so a plain app (no person-picker
     *  field) still appears in that person's transcript. Null when the
     *  submitter has no people record. */
    submitterPersonId?: string | null
  },
): Promise<number> {
  await tx
    .delete(formResponseParticipants)
    .where(eq(formResponseParticipants.responseId, args.responseId))

  const occurredOn = resolvePrimaryDate(args.schema, args.data, args.submittedAt)
  const extracted = extractParticipants(args.schema, args.data)
  const rows = extracted.map((p) => ({
    tenantId: args.tenantId,
    responseId: args.responseId,
    templateId: args.templateId,
    category: args.category,
    personId: p.personId,
    signed: p.signed,
    signedAt: p.signed ? args.submittedAt : null,
    occurredOn,
    fieldId: p.fieldId,
    sectionId: p.sectionId || null,
    role: p.role,
  }))

  // The submitter counts as a participant unless a person field already
  // captured them. Compliance ownership is resolved from formResponses;
  // this derived index exists for transcripts and participation reports.
  if (args.submitterPersonId && !extracted.some((p) => p.personId === args.submitterPersonId)) {
    rows.push({
      tenantId: args.tenantId,
      responseId: args.responseId,
      templateId: args.templateId,
      category: args.category,
      personId: args.submitterPersonId,
      signed: false,
      signedAt: null,
      occurredOn,
      fieldId: '$submitter',
      sectionId: null,
      role: 'submitter',
    })
  }

  if (rows.length === 0) return 0
  await tx.insert(formResponseParticipants).values(rows)
  return rows.length
}

type TranscriptRow = {
  participantId: string
  responseId: string
  templateName: string
  category: string | null
  status: string
  occurredOn: string | null
  signed: boolean
}

type PersonTranscript = {
  rows: TranscriptRow[]
  total: number
  totals: { responses: number; signed: number; byCategory: Record<string, number> }
}

type PersonTranscriptListOptions = {
  q?: string
  status?: (typeof formResponses.$inferSelect)['status']
  sort?: 'date' | 'form' | 'category' | 'status'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/** Every form response a person participated in / signed, newest first. */
export async function loadPersonTranscript(
  ctx: RequestContext,
  personId: string,
  options: PersonTranscriptListOptions = {},
): Promise<PersonTranscript> {
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  return ctx.db(async (tx) => {
    const requestedPage = Math.max(1, Math.min(10_000, Math.trunc(options.page ?? 1)))
    const perPage = Math.max(5, Math.min(100, Math.trunc(options.perPage ?? 25)))
    const baseConditions: SQL<unknown>[] = [
      eq(formResponseParticipants.personId, personId),
      isNull(formResponses.deletedAt),
      templateAccessWhere(ctx, effectiveRoleKeys, 'browse-records'),
    ]
    const filteredConditions = [...baseConditions]
    if (options.status) filteredConditions.push(eq(formResponses.status, options.status))
    if (options.q?.trim()) {
      const term = `%${options.q.trim()}%`
      filteredConditions.push(
        sql`concat_ws(' ', ${formTemplates.name}, coalesce(${formResponseParticipants.category}, ''), ${formResponses.status}::text, coalesce(${formResponseParticipants.occurredOn}::text, '')) ilike ${term}`,
      )
    }
    const baseWhere = and(...baseConditions)
    const filteredWhere = and(...filteredConditions)
    const direction = options.dir === 'asc' ? asc : desc
    const orderBy =
      options.sort === 'form'
        ? [direction(formTemplates.name), asc(formResponseParticipants.id)]
        : options.sort === 'category'
          ? [
              options.dir === 'asc'
                ? sql`${formResponseParticipants.category} asc nulls last`
                : sql`${formResponseParticipants.category} desc nulls last`,
              asc(formResponseParticipants.id),
            ]
          : options.sort === 'status'
            ? [direction(formResponses.status), asc(formResponseParticipants.id)]
            : [
                options.dir === 'asc'
                  ? sql`${formResponseParticipants.occurredOn} asc nulls last`
                  : sql`${formResponseParticipants.occurredOn} desc nulls last`,
                asc(formResponseParticipants.id),
              ]

    const [filteredTotal] = await tx
      .select({ c: count() })
      .from(formResponseParticipants)
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(filteredWhere)
    const total = Number(filteredTotal?.c ?? 0)
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / perPage)))
    const rows = await tx
      .select({
        participantId: formResponseParticipants.id,
        responseId: formResponseParticipants.responseId,
        templateName: formTemplates.name,
        category: formResponseParticipants.category,
        status: formResponses.status,
        occurredOn: formResponseParticipants.occurredOn,
        signed: formResponseParticipants.signed,
      })
      .from(formResponseParticipants)
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(filteredWhere)
      .orderBy(...orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage)

    const [summary] = await tx
      .select({
        responses: count(),
        signed: sql<number>`count(*) filter (where ${formResponseParticipants.signed})`.mapWith(
          Number,
        ),
      })
      .from(formResponseParticipants)
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(baseWhere)
    const categoryRows = await tx
      .select({
        category: sql<string>`coalesce(${formResponseParticipants.category}, 'other')`,
        c: count(),
      })
      .from(formResponseParticipants)
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(baseWhere)
      .groupBy(sql`coalesce(${formResponseParticipants.category}, 'other')`)

    return {
      rows: rows.map((r) => ({ ...r, status: String(r.status) })),
      total,
      totals: {
        responses: Number(summary?.responses ?? 0),
        signed: Number(summary?.signed ?? 0),
        byCategory: Object.fromEntries(categoryRows.map((row) => [row.category, Number(row.c)])),
      },
    }
  })
}

type TranscriptPeopleListOptions = {
  q?: string
  sort?: 'count' | 'name'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/** People with a participation count, for the /apps/transcripts index. */
export async function listTranscriptPeople(
  ctx: RequestContext,
  options: TranscriptPeopleListOptions = {},
): Promise<{
  rows: Array<{ personId: string; name: string; count: number }>
  total: number
}> {
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  return ctx.db(async (tx) => {
    const requestedPage = Math.max(1, Math.min(10_000, Math.trunc(options.page ?? 1)))
    const perPage = Math.max(5, Math.min(100, Math.trunc(options.perPage ?? 25)))
    const conditions: SQL<unknown>[] = [
      isNull(formResponses.deletedAt),
      isNull(people.deletedAt),
      templateAccessWhere(ctx, effectiveRoleKeys, 'browse-records'),
    ]
    if (options.q?.trim()) {
      const term = `%${options.q.trim()}%`
      conditions.push(
        sql`concat_ws(' ', ${people.firstName}, ${people.lastName}, ${people.lastName}, ${people.firstName}) ilike ${term}`,
      )
    }
    const whereClause = and(...conditions)
    const [totalRow] = await tx
      .select({
        c: sql<number>`count(distinct ${formResponseParticipants.personId})`.mapWith(Number),
      })
      .from(formResponseParticipants)
      .innerJoin(people, eq(people.id, formResponseParticipants.personId))
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(whereClause)
    const total = Number(totalRow?.c ?? 0)
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / perPage)))

    const direction = options.dir === 'asc' ? asc : desc
    const rows = await tx
      .select({
        personId: formResponseParticipants.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(formResponseParticipants)
      .innerJoin(people, eq(people.id, formResponseParticipants.personId))
      .innerJoin(formResponses, eq(formResponses.id, formResponseParticipants.responseId))
      .innerJoin(formTemplates, eq(formTemplates.id, formResponseParticipants.templateId))
      .where(whereClause)
      .groupBy(formResponseParticipants.personId, people.firstName, people.lastName)
      .orderBy(
        ...(options.sort === 'name'
          ? [direction(people.lastName), direction(people.firstName)]
          : [direction(sql`count(*)`), asc(people.lastName), asc(people.firstName)]),
        asc(formResponseParticipants.personId),
      )
      .limit(perPage)
      .offset((page - 1) * perPage)
    return {
      rows: rows.map((r) => ({
        personId: r.personId,
        name:
          `${r.lastName ?? ''}${r.lastName ? ', ' : ''}${r.firstName ?? ''}`.trim() || '(unnamed)',
        count: Number(r.count),
      })),
      total,
    }
  })
}
