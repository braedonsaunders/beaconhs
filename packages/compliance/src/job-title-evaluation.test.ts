import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./evaluate.ts', import.meta.url), 'utf8')

describe('job-title compliance cutover', () => {
  it('selects title holders from canonical assignments, never the people cache', () => {
    expect(source).toContain('personTitleAssignments')
    expect(source).toMatch(
      /eq\(personTitleAssignments\.tenantId, people\.tenantId\)[\s\S]*eq\(personTitleAssignments\.personId, people\.id\)[\s\S]*eq\(personTitleAssignments\.titleId, titleId\)/,
    )
    expect(source).toContain('isNull(jobTitleTasks.deletedAt)')
    expect(source).not.toContain('people.titleIds')
  })
})
