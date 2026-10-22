import 'server-only'
import { and, count, desc, eq, ilike, isNotNull, isNull, lt, inArray } from 'drizzle-orm'
import {
  hazidAssessments,
  hazidAssessmentSignatures,
  hazidSigningRounds,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { parsePrefixedListParams } from './list-params'
import { attachmentUrl } from './attachment-url'
export async function loadSigningHistory(
  ctx: RequestContext,
  id: string,
  params: Record<string, string | string[] | undefined>,
) {
  const list = parsePrefixedListParams(params, 'signHistory', {
    sort: 'date',
    allowedSorts: ['date'],
    perPage: 10,
  })
  return ctx.db(async (tx) => {
    const [parent] = await tx
      .select()
      .from(hazidAssessments)
      .where(
        and(
          eq(hazidAssessments.id, id),
          eq(hazidAssessments.tenantId, ctx.tenantId),
          isNull(hazidAssessments.deletedAt),
        ),
      )
      .limit(1)
    if (
      !parent ||
      !(await canSeeRecord(ctx, tx, {
        prefix: 'hazid',
        ownerIds: [parent.reportedByTenantUserId],
        siteId: parent.siteOrgUnitId,
      }))
    )
      return null
    const revision = Number(params.signHistoryRevision)
    const filter = and(
      eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
      eq(hazidAssessmentSignatures.assessmentId, id),
      lt(hazidAssessmentSignatures.revision, parent.signingRevision),
      isNotNull(hazidAssessmentSignatures.signatureAttachmentId),
      list.q ? ilike(hazidAssessmentSignatures.signerName, `%${list.q}%`) : undefined,
      Number.isSafeInteger(revision) && revision > 0
        ? eq(hazidAssessmentSignatures.revision, revision)
        : undefined,
    )
    const [total] = await tx
      .select({ total: count() })
      .from(hazidAssessmentSignatures)
      .where(filter)
    const rows = await tx
      .select()
      .from(hazidAssessmentSignatures)
      .where(filter)
      .orderBy(desc(hazidAssessmentSignatures.signedAt), desc(hazidAssessmentSignatures.id))
      .limit(list.perPage)
      .offset((list.page - 1) * list.perPage)
    const snapshots = rows.length
      ? await tx
          .select({ revision: hazidSigningRounds.revision })
          .from(hazidSigningRounds)
          .where(
            and(
              eq(hazidSigningRounds.tenantId, ctx.tenantId),
              eq(hazidSigningRounds.assessmentId, id),
              inArray(
                hazidSigningRounds.revision,
                rows.map((row) => row.revision),
              ),
            ),
          )
      : []
    const snapshotVersions = new Set(snapshots.map((row) => row.revision))
    return {
      revision: parent.signingRevision,
      ...list,
      total: total?.total ?? 0,
      rows: rows.map((row) => ({
        ...row,
        image: attachmentUrl(row.signatureAttachmentId!),
        snapshotAvailable: snapshotVersions.has(row.revision),
      })),
    }
  })
}
export async function loadSignedVersion(ctx: RequestContext, id: string, revision: number) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ parent: hazidAssessments, round: hazidSigningRounds })
      .from(hazidAssessments)
      .innerJoin(
        hazidSigningRounds,
        and(
          eq(hazidSigningRounds.tenantId, hazidAssessments.tenantId),
          eq(hazidSigningRounds.assessmentId, hazidAssessments.id),
        ),
      )
      .where(
        and(
          eq(hazidAssessments.id, id),
          eq(hazidAssessments.tenantId, ctx.tenantId),
          isNull(hazidAssessments.deletedAt),
          eq(hazidSigningRounds.revision, revision),
        ),
      )
      .limit(1)
    if (
      !row ||
      !(await canSeeRecord(ctx, tx, {
        prefix: 'hazid',
        ownerIds: [row.parent.reportedByTenantUserId],
        siteId: row.parent.siteOrgUnitId,
      }))
    )
      return null
    return row
  })
}
