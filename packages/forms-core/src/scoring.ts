import { isScoringField } from './field-types'
import type { FormSchemaV1 } from './schema'

export type ScoreRow = {
  fieldId: string
  sectionId: string
  score: number | null // 1 = pass, 0 = fail, null = n/a (Pass/Fail/N/A); raw value for rating
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
      const value = values[field.id]
      if (value === undefined) continue
      const weight = (field.config?.weight as number | undefined) ?? 1

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
        const score = s === 'green' ? 1 : s === 'yellow' ? 0.5 : s === 'red' ? 0 : null
        out.push({ fieldId: field.id, sectionId: section.id, score, label: s, weight: 1 })
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
  return out
}

export function rollupScore(rows: ScoreRow[]): {
  pass: number
  fail: number
  na: number
  pct: number
} {
  let pass = 0
  let fail = 0
  let na = 0
  let totalWeight = 0
  let earnedWeight = 0
  for (const r of rows) {
    if (r.score === null) {
      na += 1
      continue
    }
    if (r.score === 1) pass += 1
    else if (r.score === 0) fail += 1
    totalWeight += r.weight
    earnedWeight += r.score * r.weight
  }
  const pct = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0
  return { pass, fail, na, pct }
}
