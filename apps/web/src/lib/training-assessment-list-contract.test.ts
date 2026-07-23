import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const listPage = readFileSync(
  new URL('../app/(app)/training/assessments/page.tsx', import.meta.url),
  'utf8',
)
const detailPage = readFileSync(
  new URL('../app/(app)/training/assessments/[id]/page.tsx', import.meta.url),
  'utf8',
)

describe('training assessment history navigation', () => {
  it('keeps the assessment title and explicit action as native record links', () => {
    expect(listPage).toContain(
      '<a\n                              href={`/training/assessments/${attempt.id}`}',
    )
    expect(listPage).toContain('<a href={`/training/assessments/${attempt.id}`}>')
    expect(listPage).toContain("? 'Review'")
    expect(listPage).toContain("? 'Continue'")
    expect(listPage).toContain(": 'View'")
  })

  it('does not manufacture durations or precise completion times for legacy imports', () => {
    expect(listPage).toContain(
      "attempt.notes?.startsWith('Migrated legacy quiz attempt.') ?? false",
    )
    expect(listPage).toContain('!isMigratedLegacy && endedAt && attempt.startedAt')
    expect(listPage).toContain(
      'coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.submittedAt}, ${trainingAssessments.startedAt})',
    )
    expect(detailPage).toContain('isMigratedLegacy')
    expect(detailPage).toContain('? formatDate(')
  })
})
