import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ACTION_FILES = [
  '../app/(app)/admin/users/_actions.ts',
  '../app/(app)/admin/roles/_actions.ts',
  '../app/(app)/platform/users/_actions.ts',
] as const

describe('role-assignment action contract', () => {
  it('routes every assignment insert through the atomic conflict handler', () => {
    for (const relativePath of ACTION_FILES) {
      const actionSource = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      expect(actionSource, relativePath).not.toContain('.insert(roleAssignments)')
      expect(actionSource, relativePath).toContain('upsertRoleAssignments')
    }
  })

  it('does not describe a scope upsert as an unconditional new assignment', () => {
    const userActions = readFileSync(
      new URL('../app/(app)/admin/users/_actions.ts', import.meta.url),
      'utf8',
    )
    const roleActions = readFileSync(
      new URL('../app/(app)/admin/roles/_actions.ts', import.meta.url),
      'utf8',
    )

    expect(userActions).toContain('Set role "${role.name}" and its access scope')
    expect(userActions).not.toContain('summary: `Assigned role')
    expect(roleActions).toContain('Set role "${role.name}" and its access scope')
    expect(roleActions).not.toContain('summary: `Added to role')
    expect(userActions).toContain('recordAuditInTransaction(tx, ctx')
    expect(roleActions).toContain('recordAuditInTransaction(tx, ctx')
  })
})
