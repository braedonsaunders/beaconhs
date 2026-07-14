import { and, asc, count, ilike, or, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { trainingExtraFields } from '@beaconhs/db/schema'

type TrainingExtraFieldPage = {
  rows: Array<{
    id: string
    fieldKey: string
    fieldValue: string | null
  }>
  total: number
  filteredTotal: number
}

/**
 * Load one owner-bound additional-field list without materializing the full
 * table. Callers supply the physical owner predicate so the same exact-count,
 * stable-order query is shared by assignments, skill types, and authorities.
 */
export async function loadTrainingExtraFieldPage(
  tx: Database,
  ownerWhere: SQL,
  params: { q?: string; page: number; perPage: number },
): Promise<TrainingExtraFieldPage> {
  const search = params.q
    ? or(
        ilike(trainingExtraFields.fieldKey, `%${params.q}%`),
        ilike(trainingExtraFields.fieldValue, `%${params.q}%`),
      )
    : undefined
  const filteredWhere = and(ownerWhere, search)

  const [[allCount], [matchingCount], rows] = await Promise.all([
    tx.select({ value: count() }).from(trainingExtraFields).where(ownerWhere),
    tx.select({ value: count() }).from(trainingExtraFields).where(filteredWhere),
    tx
      .select({
        id: trainingExtraFields.id,
        fieldKey: trainingExtraFields.fieldKey,
        fieldValue: trainingExtraFields.fieldValue,
      })
      .from(trainingExtraFields)
      .where(filteredWhere)
      .orderBy(
        asc(trainingExtraFields.sortOrder),
        asc(trainingExtraFields.createdAt),
        asc(trainingExtraFields.id),
      )
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage),
  ])

  return {
    rows,
    total: Number(allCount?.value ?? 0),
    filteredTotal: Number(matchingCount?.value ?? 0),
  }
}
