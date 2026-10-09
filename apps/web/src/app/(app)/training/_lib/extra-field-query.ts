import { and, asc, count, ilike, or, sql, type SQL } from 'drizzle-orm'
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

export async function loadSkillInputPage(
  tx: Database,
  assignmentId: string,
  typeId: string | null,
  authorityId: string | null,
  params: { q?: string; page: number; perPage: number },
) {
  const fields = sql`WITH candidates AS (
    SELECT definition.id, definition.field_key, CASE WHEN definition.value_mode = 'type' THEN definition.field_value ELSE answer.field_value END AS field_value,
      definition.value_mode = 'record' AS editable, CASE WHEN definition.skill_type_id IS NOT NULL THEN 0 ELSE 1 END AS priority
    FROM training_extra_fields definition
    LEFT JOIN training_extra_fields answer ON answer.tenant_id = definition.tenant_id AND answer.skill_assignment_id = ${assignmentId}::uuid AND lower(answer.field_key) = lower(definition.field_key)
    WHERE definition.skill_type_id = ${typeId}::uuid OR definition.authority_id = ${authorityId}::uuid
    UNION ALL
    SELECT id, field_key, field_value, false AS editable, 2 AS priority FROM training_extra_fields WHERE skill_assignment_id = ${assignmentId}::uuid
  ), fields AS (SELECT DISTINCT ON (lower(field_key)) * FROM candidates ORDER BY lower(field_key), priority, id)
  `
  const match = params.q
    ? sql`WHERE field_key ILIKE ${`%${params.q}%`} OR field_value ILIKE ${`%${params.q}%`}`
    : sql``
  const [counts, rows] = await Promise.all([
    tx.execute<{ total: string }>(sql`${fields} SELECT count(*) AS total FROM fields ${match}`),
    tx.execute<{ id: string; field_key: string; field_value: string | null; editable: boolean }>(
      sql`${fields} SELECT id, field_key, field_value, editable FROM fields ${match} ORDER BY lower(field_key), id LIMIT ${params.perPage} OFFSET ${(params.page - 1) * params.perPage}`,
    ),
  ])
  return { rows: [...rows], total: Number(counts[0]?.total ?? 0) }
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
