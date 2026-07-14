import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./evaluate.ts', import.meta.url), 'utf8')

describe('hazard-assessment compliance evidence', () => {
  it('counts only signed evidence on completed assessments', () => {
    const start = source.indexOf('async function evalHazardAssessment')
    const end = source.indexOf('// ---- per_record adapters', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const evaluator = source.slice(start, end)

    expect(evaluator).toContain('isNotNull(hazidAssessmentSignatures.signedAt)')
    expect(evaluator.match(/eq\(hazidAssessments\.locked, true\)/gu)).toHaveLength(2)
  })
})
