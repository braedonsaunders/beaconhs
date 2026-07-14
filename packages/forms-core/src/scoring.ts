import { isScoringField } from './field-types'
import type { FormSchemaV1 } from './schema'

export type ScoreRow = {
  fieldId: string
  sectionId: string
  // Integer scale: pass/fail = 1/0, traffic light = 2/1/0, rating/risk = raw
  // integer score, null = N/A.
  score: number | null
  label: string
  weight: number
}

/**
 * Extract a normalized list of scored fields from a response payload.
 * Persisted to form_response_scores for analytic roll-ups.
 */
export function extractScores(schema: FormSchemaV1, values: Record<string, unknown>): ScoreRow[] {
  const out: ScoreRow[] = []
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!isScoringField(field.type)) continue
      const configuredWeight = field.config?.weight
      const weight =
        typeof configuredWeight === 'number' &&
        Number.isInteger(configuredWeight) &&
        configuredWeight >= 1 &&
        configuredWeight <= 100
          ? configuredWeight
          : 1
      const fieldValues = section.repeating
        ? Array.isArray(values[section.id])
          ? (values[section.id] as unknown[])
              .filter(
                (row): row is Record<string, unknown> =>
                  typeof row === 'object' && row !== null && !Array.isArray(row),
              )
              .map((row) => row[field.id])
          : []
        : [values[field.id]]

      for (const value of fieldValues) {
        if (value === undefined) continue
        if (field.type === 'pass_fail_na') {
          const s = String(value)
          const score = s === 'pass' ? 1 : s === 'fail' ? 0 : null
          out.push({ fieldId: field.id, sectionId: section.id, score, label: s, weight })
        } else if (field.type === 'rating') {
          const n = Number(value)
          out.push({
            fieldId: field.id,
            sectionId: section.id,
            score: Number.isFinite(n) ? n : null,
            label: `rating:${n}`,
            weight,
          })
        } else if (field.type === 'yes_no_comment') {
          const yn = (value as { answer?: string } | undefined)?.answer
          const score = yn === 'yes' ? 1 : yn === 'no' ? 0 : null
          out.push({ fieldId: field.id, sectionId: section.id, score, label: yn ?? '', weight })
        } else if (field.type === 'traffic_light') {
          const s = String(value)
          const score = s === 'green' ? 2 : s === 'yellow' ? 1 : s === 'red' ? 0 : null
          out.push({ fieldId: field.id, sectionId: section.id, score, label: s, weight })
        } else if (field.type === 'risk_matrix') {
          const v = value as { score?: number; label?: string } | undefined
          out.push({
            fieldId: field.id,
            sectionId: section.id,
            score: v?.score ?? null,
            label: v?.label ?? '',
            weight,
          })
        }
      }
    }
  }
  return out
}
