import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('training assessment compliance cutover contract', () => {
  it('replaces the retired assignment link with a tenant-safe obligation link', () => {
    const schema = source('../../../../packages/db/src/schema/training-assessments.ts')
    expect(schema).not.toContain("assignmentId: uuid('assignment_id')")
    expect(schema).toContain("complianceObligationId: uuid('compliance_obligation_id')")
    expect(schema).toContain("name: 'training_assessments_tenant_compliance_obligation_fk'")
    expect(schema).toContain("'training_assessments_active_compliance_attempt_ux'")
    expect(schema).toContain(
      'foreignColumns: [complianceObligations.tenantId, complianceObligations.id]',
    )
  })

  it('authorizes and persists the exact outstanding assessment requirement', () => {
    const actions = source('../app/(app)/training/_actions/assessments.ts')
    const attempts = source('../app/(app)/training/_lib/assessment-attempts.ts')
    const myTraining = source('../app/(app)/my/training/page.tsx')
    expect(actions).toContain('eq(complianceObligations.id, complianceObligationId)')
    expect(actions).toContain('requirement.targetRef?.assessmentTypeId !== typeId')
    expect(actions).toContain('eq(complianceStatus.personId, personId)')
    expect(actions).toContain(
      "inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue', 'expiring'])",
    )
    expect(attempts).toContain('complianceObligationId: args.complianceObligationId ?? null')
    expect(attempts).toContain('if (existing) return { attempt: existing, created: false }')
    expect(actions).toContain('await materializeEvidenceTargetsObligations(tx, tenantId')
    expect(actions).toContain('targetRef: { assessmentTypeId: typeId }')
    expect(myTraining).toContain('obligationId: obligation.id')
  })

  it('counts only attempts linked to the obligation being evaluated', () => {
    const evaluator = source('../../../../packages/compliance/src/evaluate.ts')
    const exactLink = 'eq(trainingAssessments.complianceObligationId, ob.id)'
    expect(evaluator.split(exactLink)).toHaveLength(3)
  })
})
