import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return text.slice(startIndex, endIndex)
}

describe('identity catalog lifecycle contract', () => {
  it('serializes every person-group membership writer and audits in-transaction', () => {
    const groups = source('../app/(app)/people/_actions/groups.ts')
    const bulk = source('../app/(app)/people/_actions/bulk.ts')
    const personSaver = source('../app/(app)/people/_record-edits.ts')
    const personAssignments = source('../app/(app)/people/_lib/person-assignments.ts')
    const helper = source('./person-group-memberships.ts')

    expect(helper).toContain('pg_advisory_xact_lock')
    expect(helper).toContain('tenant_id = ${tenantId}')
    // Group-centric writers (membership editor, delete) take the graph lock.
    expect(groups.match(/lockPersonGroupMembershipGraph\(/g)?.length).toBe(2)
    expect(bulk).toContain('lockPersonGroupMembershipGraph(tx, ctx.tenantId)')
    // The person-centric writer (the person page's Groups field, applied by the
    // people record saver) takes it before locking the person row.
    expect(personSaver.indexOf('lockPersonGroupMembershipGraph(tx, ctx.tenantId)')).toBeGreaterThan(
      0,
    )
    expect(personSaver.indexOf('lockPersonGroupMembershipGraph(tx, ctx.tenantId)')).toBeLessThan(
      personSaver.indexOf(".for('update')"),
    )
    expect(personAssignments).toContain('refreshPersonGroupCache(tx, ctx.tenantId, [personId])')
    for (const writer of [groups, personAssignments]) {
      expect(writer).not.toContain('recordAudit(ctx')
    }
    expect(groups.match(/recordAuditInTransaction\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(personAssignments).toContain("summary: 'Updated group memberships'")
    expect(bulk.indexOf('recordAuditInTransaction')).toBeLessThan(
      bulk.indexOf("revalidatePath('/people')"),
    )
  })

  it('locks identity catalog owners before checking compliance audience dependencies', () => {
    const departments = source('../app/(app)/people/_actions/departments.ts')
    const workforce = source('../app/(app)/people/_actions/workforce.ts')
    const roles = source('../app/(app)/admin/roles/_actions.ts')
    const cases = [
      departments.slice(departments.indexOf('export async function deleteDepartment')),
      between(workforce, 'export async function deleteTrade', 'export async function saveCrew'),
      between(
        roles,
        'export async function deleteRole',
        'export async function saveRoleDashboardLayout',
      ),
    ]

    for (const action of cases) {
      expect(action.indexOf(".for('update')")).toBeLessThan(
        action.indexOf('countComplianceAudienceTargetUses('),
      )
      expect(action).toContain('recordAuditInTransaction')
    }

    const helper = source('../../../../packages/compliance/src/audience-targets.ts')
    expect(helper).toContain('eq(complianceAudience.tenantId, tenantId)')
    expect(helper).toContain('isNull(complianceObligations.deletedAt)')
  })
})
