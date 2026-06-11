// Form participants — server-side write + read helpers around the
// form_response_participants table. The pure extraction lives in
// @beaconhs/forms-core; this owns persistence (delete+reinsert on submit) and
// the per-person transcript read used by the people page + /forms/transcripts.

import { desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { formResponseParticipants, formResponses, formTemplates, people } from '@beaconhs/db/schema'
import { extractParticipants, type FormSchemaV1 } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'

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
  },
): Promise<number> {
  await tx
    .delete(formResponseParticipants)
    .where(eq(formResponseParticipants.responseId, args.responseId))

  const extracted = extractParticipants(args.schema, args.data)
  if (extracted.length === 0) return 0

  const occurredOn = resolvePrimaryDate(args.schema, args.data, args.submittedAt)
  await tx.insert(formResponseParticipants).values(
    extracted.map((p) => ({
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
    })),
  )
  return extracted.length
}

export type TranscriptRow = {
  participantId: string
  responseId: string
  templateName: string
  category: string | null
  status: string
  occurredOn: string | null
  signed: boolean
}

export type PersonTranscript = {
  rows: TranscriptRow[]
  totals: { responses: number; signed: number; byCategory: Record<string, number> }
}

/** Every form response a person participated in / signed, newest first. */
export async function loadPersonTranscript(
  ctx: RequestContext,
  personId: string,
): Promise<PersonTranscript> {
  return ctx.db(async (tx) => {
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
      .where(eq(formResponseParticipants.personId, personId))
      .orderBy(desc(formResponseParticipants.occurredOn))
      .limit(500)

    const byCategory: Record<string, number> = {}
    let signed = 0
    for (const r of rows) {
      const key = r.category ?? 'other'
      byCategory[key] = (byCategory[key] ?? 0) + 1
      if (r.signed) signed += 1
    }
    return {
      rows: rows.map((r) => ({ ...r, status: String(r.status) })),
      totals: { responses: rows.length, signed, byCategory },
    }
  })
}

/** People with a participation count, for the /forms/transcripts index. */
export async function listTranscriptPeople(
  ctx: RequestContext,
): Promise<Array<{ personId: string; name: string; count: number }>> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        personId: formResponseParticipants.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(formResponseParticipants)
      .innerJoin(people, eq(people.id, formResponseParticipants.personId))
      .groupBy(formResponseParticipants.personId, people.firstName, people.lastName)
      .orderBy(desc(sql`count(*)`))
      .limit(500)
    return rows.map((r) => ({
      personId: r.personId,
      name:
        `${r.lastName ?? ''}${r.lastName ? ', ' : ''}${r.firstName ?? ''}`.trim() || '(unnamed)',
      count: Number(r.count),
    }))
  })
}
