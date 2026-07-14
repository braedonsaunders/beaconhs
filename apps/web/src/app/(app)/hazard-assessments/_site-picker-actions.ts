'use server'

import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { hazidAssessments, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import {
  boundPickerOptions,
  PICKER_RESULT_LIMIT,
  type PickerOptionsResponse,
} from '@/lib/picker-options'
import { parseRemoteSearchInput, remoteSearchTerm } from '@/lib/remote-search-policy'

async function loadSiteOptions(input: unknown, mineOnly: boolean): Promise<PickerOptionsResponse> {
  const search = parseRemoteSearchInput(input, 'uuid')
  const ctx = await requireRequestContext()
  const term = remoteSearchTerm(search.query)

  return ctx.db(async (tx) => {
    // This is the exact list visibility predicate. A remote picker must never
    // reveal a site merely because it exists elsewhere in the tenant.
    const visibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'hazid',
      ownerCols: [hazidAssessments.reportedByTenantUserId],
      siteCol: hazidAssessments.siteOrgUnitId,
    })
    const conditions: SQL[] = [
      eq(hazidAssessments.tenantId, ctx.tenantId),
      isNull(hazidAssessments.deletedAt),
    ]
    if (visibility) conditions.push(visibility)
    if (mineOnly) {
      conditions.push(
        ctx.membership?.id
          ? eq(hazidAssessments.reportedByTenantUserId, ctx.membership.id)
          : sql`false`,
      )
    }
    if (term || search.selected) {
      conditions.push(
        or(
          term ? ilike(orgUnits.name, term) : undefined,
          term ? ilike(orgUnits.code, term) : undefined,
          search.selected ? eq(orgUnits.id, search.selected) : undefined,
        )!,
      )
    }

    const rows = await tx
      .select({
        id: orgUnits.id,
        name: orgUnits.name,
        code: orgUnits.code,
        count: sql<number>`count(*)::int`,
      })
      .from(hazidAssessments)
      .innerJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .where(and(...conditions))
      .groupBy(orgUnits.id, orgUnits.name, orgUnits.code)
      .orderBy(
        ...(search.selected ? [desc(sql`${orgUnits.id} = ${search.selected}`)] : []),
        asc(orgUnits.name),
        asc(orgUnits.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)

    return boundPickerOptions(
      rows.map((row) => ({
        value: row.id,
        label: row.name.trim().slice(0, 240),
        hint: `${row.count} assessment${row.count === 1 ? '' : 's'}${row.code ? ` · ${row.code}` : ''}`.slice(
          0,
          120,
        ),
      })),
    )
  })
}

export async function loadHazardAssessmentSiteOptions(
  input: unknown,
): Promise<PickerOptionsResponse> {
  return loadSiteOptions(input, false)
}

export async function loadMyHazardAssessmentSiteOptions(
  input: unknown,
): Promise<PickerOptionsResponse> {
  return loadSiteOptions(input, true)
}
