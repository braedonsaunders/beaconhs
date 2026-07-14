import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('form compliance cutover contract', () => {
  it('has one scheduled-assignment store and tenant-bound response provenance', () => {
    const schema = source('../../../../../packages/db/src/schema/forms.ts')
    expect(schema).not.toContain("pgTable(\n  'form_assignments'")
    expect(schema).toContain("complianceObligationId: uuid('compliance_obligation_id')")
    expect(schema).toContain("name: 'form_responses_tenant_compliance_obligation_fk'")
    expect(schema).toContain(
      'foreignColumns: [complianceObligations.tenantId, complianceObligations.id]',
    )
    expect(
      existsSync(
        new URL(
          '../../../../../packages/db/src/schema/form-assignment-dispatches.ts',
          import.meta.url,
        ),
      ),
    ).toBe(false)
  })

  it('authorizes the selected obligation and rematerializes template evidence on submit', () => {
    const lifecycle = source('./form-response-lifecycle.ts')
    const obligation = source('./form-compliance-obligation.ts')
    const evidence = source('./form-response-evidence.ts')
    expect(lifecycle).toContain('loadApplicableFormObligation(')
    expect(lifecycle).toContain('complianceObligationId,')
    expect(lifecycle).toContain('materializeFormResponseEvidenceChange(tx, ctx.tenantId')
    expect(evidence).toContain('await materializeEvidenceTargetObligations(tx, tenantId')
    expect(evidence).toContain("sourceModule: 'form'")
    expect(evidence).toContain('targetRef: { formTemplateId }')
    expect(obligation).toContain(
      "inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue'])",
    )
  })

  it('counts only the response owner in the exact cron period', () => {
    const evaluator = source('../../../../../packages/compliance/src/evaluate.ts')
    expect(evaluator).toContain('resolveCronWindow(ob.recurrence, clock, ob.createdAt)')
    expect(evaluator).toContain('eq(tenantUsers.id, formResponses.submittedBy)')
    expect(evaluator).toContain('eq(people.userId, tenantUsers.userId)')
    expect(evaluator).toContain('eq(formResponses.complianceObligationId, ob.id)')
    expect(evaluator).toContain('gte(formResponses.submittedAt, window.evidenceStartAt)')
    expect(evaluator).toContain('lt(formResponses.submittedAt, window.periodEndAt)')
    expect(evaluator).toContain('subjectRef: evidence ? { responseId: evidence.responseId } : null')
  })
})
