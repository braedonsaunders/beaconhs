import { and, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/pg-core'
import {
  documentAcknowledgments,
  documentVersions,
  documents,
  journalEntries,
  hazidAssessments,
  incidents,
  inspectionRecords,
  inspectionTypes,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { can } from '@beaconhs/tenant'
import { parseListParams, pickString } from './list-params'

type WorkspaceEntryKind = 'journal' | 'hazard_assessment' | 'incident' | 'inspection' | 'document'
export type WorkspaceEntry = {
  id: string
  kind: WorkspaceEntryKind
  title: string
  href: string | null
  updatedAt: string
  detail?: string
}

/** Inverse of Workspace's unfinished feed, plus personal reading/sign-off evidence.
 * Queries stay in the active tenant and never accept another person's identity.
 */
export async function loadWorkspaceHistory(
  ctx: RequestContext,
  search: Record<string, string | string[] | undefined> = {},
) {
  const params = parseListParams(search, { sort: 'date', allowedSorts: ['date'], perPage: 24 })
  const membership = ctx.membership?.id
  if (!membership)
    return { rows: [] as WorkspaceEntry[], total: 0, page: 1, perPage: params.perPage }
  return ctx.db(async (tx) => {
    const history = unionAll(
      tx
        .select({
          id: journalEntries.id,
          kind: sql<string>`'journal'`.as('kind'),
          title:
            sql<string>`coalesce(nullif(${journalEntries.title}, ''), ${journalEntries.reference})`.as(
              'title',
            ),
          at: sql<Date>`coalesce(${journalEntries.submittedAt},${journalEntries.updatedAt})`.as(
            'at',
          ),
          href: sql<string | null>`'/journals/' || ${journalEntries.id}`.as('href'),
          detail: sql<string>`''`.as('detail'),
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.createdByTenantUserId, membership),
            ne(journalEntries.status, 'draft'),
            isNull(journalEntries.deletedAt),
          ),
        ),
      tx
        .select({
          id: hazidAssessments.id,
          kind: sql<string>`'hazard_assessment'`,
          title: hazidAssessments.reference,
          at: sql<Date>`coalesce(${hazidAssessments.lockedAt},${hazidAssessments.updatedAt})`,
          href: sql<string | null>`'/hazard-assessments/' || ${hazidAssessments.id}`,
          detail: sql<string>`''`,
        })
        .from(hazidAssessments)
        .where(
          and(
            eq(hazidAssessments.reportedByTenantUserId, membership),
            eq(hazidAssessments.inProgress, false),
            isNull(hazidAssessments.deletedAt),
          ),
        ),
      tx
        .select({
          id: incidents.id,
          kind: sql<string>`'incident'`,
          title: sql<string>`coalesce(nullif(${incidents.title},''),${incidents.reference})`,
          at: incidents.reportedAt,
          href: sql<string | null>`'/incidents/' || ${incidents.id}`,
          detail: sql<string>`''`,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.reportedByTenantUserId, membership),
            eq(incidents.isDraft, false),
            isNull(incidents.deletedAt),
          ),
        ),
      tx
        .select({
          id: inspectionRecords.id,
          kind: sql<string>`'inspection'`,
          title: sql<string>`coalesce(${inspectionTypes.name},${inspectionRecords.reference})`,
          at: sql<Date>`coalesce(${inspectionRecords.submittedAt},${inspectionRecords.updatedAt})`,
          href: sql<string | null>`'/inspections/records/' || ${inspectionRecords.id}`,
          detail: sql<string>`''`,
        })
        .from(inspectionRecords)
        .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
        .where(
          and(
            eq(inspectionRecords.inspectorTenantUserId, membership),
            inArray(inspectionRecords.status, ['submitted', 'closed']),
            isNull(inspectionRecords.deletedAt),
          ),
        ),
      tx
        .select({
          id: documentAcknowledgments.id,
          kind: sql<string>`'document'`,
          title: documents.title,
          at: documentAcknowledgments.acknowledgedAt,
          href: sql<
            string | null
          >`case when ${documents.deletedAt} is null then '/documents/' || ${documents.id} || '/versions/' || ${documentVersions.id} || '/download?inline=1' else null end`,
          detail: sql<string>`case when ${documentAcknowledgments.sessionId} is null then 'Individual acknowledgment' else 'Group sign-off' end || ' · v' || ${documentVersions.version}`,
        })
        .from(documentAcknowledgments)
        .innerJoin(documents, eq(documents.id, documentAcknowledgments.documentId))
        .innerJoin(documentVersions, eq(documentVersions.id, documentAcknowledgments.versionId))
        .where(
          and(
            eq(documentAcknowledgments.tenantId, ctx.tenantId),
            ctx.personId ? eq(documentAcknowledgments.personId, ctx.personId) : sql`false`,
          ),
        ),
    ).as('history')
    const kind = pickString(search.kind)
    const q = params.q?.replace(/[\\%_]/g, '\\$&')
    const where = and(
      kind && ['journal', 'hazard_assessment', 'incident', 'inspection', 'document'].includes(kind)
        ? eq(history.kind, kind)
        : undefined,
      q ? or(ilike(history.title, `%${q}%`), ilike(history.detail, `%${q}%`)) : undefined,
    )
    const [total] = await tx.select({ value: count() }).from(history).where(where)
    const page = Math.min(params.page, Math.max(1, Math.ceil((total?.value ?? 0) / params.perPage)))
    const rows = await tx
      .select()
      .from(history)
      .where(where)
      .orderBy(desc(history.at), desc(history.kind), desc(history.id))
      .limit(params.perPage)
      .offset((page - 1) * params.perPage)
    return {
      rows: rows.map((row) => ({
        id: row.id,
        kind: row.kind as WorkspaceEntryKind,
        title: row.title,
        href: row.kind === 'document' && !can(ctx, 'documents.read') ? null : row.href,
        updatedAt: new Date(row.at).toISOString(),
        detail: row.detail,
      })),
      total: total?.value ?? 0,
      page,
      perPage: params.perPage,
    }
  })
}
