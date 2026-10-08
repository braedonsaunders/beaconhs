import 'server-only'

import { and, desc, count, eq, isNull, sql } from 'drizzle-orm'
import { activeTenantUsersWhere } from '@beaconhs/db'
import {
  hazidAssessments,
  hazidAssessmentSignatures,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canSeeRecord } from './visibility'
import { attachmentUrl } from './attachment-url'
import { parsePrefixedListParams } from './list-params'

type SigningRosterRow = {
  id: string
  name: string
  signedAt: string | null
  image: string | null
  requestedAt: string | null
  expiresAt: string | null
  remoteAvailable: boolean
  active: boolean
}
export type SigningRosterData = {
  rows: SigningRosterRow[]
  total: number
  crewTotal: number
  signed: number
  revision: number
  locked: boolean
  page: number
  perPage: number
}

export async function loadHazidSigningRoster(
  ctx: RequestContext,
  assessmentId: string,
  params: Record<string, string | string[] | undefined>,
): Promise<SigningRosterData | null> {
  const list = parsePrefixedListParams({ crewPage: params.crewPage }, 'crew', {
    sort: 'name',
    dir: 'asc',
    allowedSorts: ['name'],
    perPage: 25,
  })
  return ctx.db(async (tx) => {
    const [parent] = await tx
      .select()
      .from(hazidAssessments)
      .where(
        and(
          eq(hazidAssessments.tenantId, ctx.tenantId),
          eq(hazidAssessments.id, assessmentId),
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
    const name = sql<string>`coalesce(${hazidAssessmentSignatures.signerName}, nullif(concat_ws(' ', ${people.firstName}, ${people.lastName}), ''), ${hazidAssessmentSignatures.externalName}, 'Unknown')`
    const base = and(
      eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
      eq(hazidAssessmentSignatures.assessmentId, parent.id),
      eq(hazidAssessmentSignatures.revision, parent.signingRevision),
    )
    const filtered = base
    const [counts] = await tx
      .select({
        crewTotal: count(),
        signed: sql<number>`count(*) filter (where ${hazidAssessmentSignatures.signatureAttachmentId} is not null)::int`,
      })
      .from(hazidAssessmentSignatures)
      .where(base)
    const [matched] = await tx
      .select({ total: count() })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(filtered)
    const rows = await tx
      .select({ row: hazidAssessmentSignatures, name, person: people, userId: tenantUsers.userId })
      .from(hazidAssessmentSignatures)
      .leftJoin(
        people,
        and(
          eq(people.tenantId, hazidAssessmentSignatures.tenantId),
          eq(people.id, hazidAssessmentSignatures.personId),
        ),
      )
      .leftJoin(
        tenantUsers,
        and(
          eq(tenantUsers.tenantId, people.tenantId),
          eq(tenantUsers.userId, people.userId),
          activeTenantUsersWhere(),
        ),
      )
      .where(filtered)
      .orderBy(desc(hazidAssessmentSignatures.createdAt), desc(hazidAssessmentSignatures.id))
      .limit(list.perPage)
      .offset((list.page - 1) * list.perPage)
    return {
      rows: rows.map(({ row, name, person, userId }) => ({
        id: row.id,
        name,
        signedAt: row.signedAt?.toISOString() ?? null,
        image: row.signatureAttachmentId ? attachmentUrl(row.signatureAttachmentId) : null,
        requestedAt: row.requestedAt?.toISOString() ?? null,
        expiresAt: row.requestExpiresAt?.toISOString() ?? null,
        active: !row.personId || (!!person && person.status === 'active' && !person.deletedAt),
        remoteAvailable: !!userId && person?.status === 'active' && !person?.deletedAt,
      })),
      total: matched?.total ?? 0,
      crewTotal: counts?.crewTotal ?? 0,
      signed: counts?.signed ?? 0,
      revision: parent.signingRevision,
      locked: parent.locked,
      page: list.page,
      perPage: list.perPage,
    }
  })
}
