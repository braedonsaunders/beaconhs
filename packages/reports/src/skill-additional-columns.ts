import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import type { ReportEntityColumn } from '@braedonsaunders/appkit-reports'

const ADDITIONAL_FIELD_TABLES = new Set(['report_skill_assignments', 'report_skill_coverage'])

type AdditionalReportField = {
  key: string
  label: string
  values: string[]
}

/** A stable, bounded identifier even for punctuation, Unicode, or long field names. */
export function skillAdditionalColumnKey(fieldKey: string): string {
  return `af_${createHash('sha256').update(fieldKey.toLowerCase()).digest('hex').slice(0, 32)}`
}

export function skillAdditionalReportColumns(
  table: string,
  fields: readonly AdditionalReportField[],
): ReportEntityColumn[] {
  if (!ADDITIONAL_FIELD_TABLES.has(table)) return []
  return fields.map((field) => ({
    key: skillAdditionalColumnKey(field.key),
    label: field.label,
    kind: 'text',
    expression: `"${table}"."additional_fields"->>'${field.key.replaceAll("'", "''")}'`,
    filterOptions: field.values.map((value) => ({ value, label: value })),
  }))
}

/** Pick-list choices come only from fixed definitions, never private employee answers.
 * This query runs inside the caller's authorized tenant/RLS transaction. */
export async function loadSkillAdditionalReportColumns(
  tx: Database,
  table: string,
): Promise<ReportEntityColumn[]> {
  if (!ADDITIONAL_FIELD_TABLES.has(table)) return []
  const fields = await tx.execute<{ key: string; label: string; values: string[] }>(sql`
    SELECT lower(field.field_key) AS key, min(field.field_key) AS label,
      coalesce(array_agg(DISTINCT field.field_value ORDER BY field.field_value)
        FILTER (WHERE field.value_mode = 'type' AND field.field_value IS NOT NULL
          AND field.field_value <> '' AND field.skill_assignment_id IS NULL), ARRAY[]::text[]) AS values
    FROM training_extra_fields field
    LEFT JOIN training_skill_types type ON type.tenant_id = field.tenant_id AND type.id = field.skill_type_id
    LEFT JOIN training_skill_authorities authority ON authority.tenant_id = field.tenant_id AND authority.id = field.authority_id
    LEFT JOIN training_skill_assignments assignment ON assignment.tenant_id = field.tenant_id AND assignment.id = field.skill_assignment_id
    WHERE (type.id IS NOT NULL AND type.deleted_at IS NULL)
      OR authority.id IS NOT NULL
      OR (assignment.id IS NOT NULL AND assignment.deleted_at IS NULL)
    GROUP BY lower(field.field_key)
    ORDER BY lower(min(field.field_key)), lower(field.field_key)
  `)
  return skillAdditionalReportColumns(table, [...fields])
}
