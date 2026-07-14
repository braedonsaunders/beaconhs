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

function expectOwnerThenObligation(action: string): void {
  const ownerLock = action.indexOf(".for('update')")
  const obligationCheck = action.indexOf('assertComplianceTargetCanRetire(')
  expect(ownerLock).toBeGreaterThanOrEqual(0)
  expect(obligationCheck).toBeGreaterThan(ownerLock)
  expect(action).toContain('recordAuditInTransaction')
}

describe('compliance target retirement contract', () => {
  it('matches every target family and fail-closes on active tenant obligations', () => {
    const helper = source('../../../../packages/compliance/src/target-retirement.ts')
    for (const targetKey of [
      'inspectionTypeId',
      'documentId',
      'courseId',
      'assessmentTypeId',
      'skillTypeId',
      'formTemplateId',
      'equipmentTypeId',
      'ppeTypeId',
    ]) {
      expect(helper).toContain(`targetRefKey: '${targetKey}'`)
    }
    expect(helper).toContain('eq(complianceObligations.tenantId, tenantId)')
    expect(helper).toContain("eq(complianceObligations.status, 'active')")
    expect(helper).toContain('isNull(complianceObligations.deletedAt)')
    expect(helper).toContain(".for('key share')")
  })

  it('locks inspection types before delete or unpublish and audits atomically', () => {
    const actions = source('../app/(app)/inspections/types/_actions.ts')
    const builder = source('../app/(app)/inspections/types/[id]/_type-builder.tsx')
    expectOwnerThenObligation(
      between(
        actions,
        'export async function deleteInspectionType',
        'export async function toggleInspectionTypePublished',
      ),
    )
    expectOwnerThenObligation(
      between(actions, 'export async function toggleInspectionTypePublished', '// --- groups'),
    )
    const toggle = between(builder, 'function togglePublish', 'return (')
    expect(toggle.indexOf('await toggleInspectionTypePublished')).toBeLessThan(
      toggle.indexOf('setPublished(next)'),
    )
  })

  it('locks assessment types before deactivate or delete and audits atomically', () => {
    const actions = source('../app/(app)/training/_actions/assessment-types.ts')
    expectOwnerThenObligation(
      between(
        actions,
        'export async function updateAssessmentType',
        'export async function deleteAssessmentType',
      ),
    )
    expectOwnerThenObligation(
      between(actions, 'export async function deleteAssessmentType', '// ----- Question CRUD'),
    )
  })

  it('locks equipment types before usage and obligation checks and audits atomically', () => {
    const page = source('../app/(app)/equipment/types/page.tsx')
    expectOwnerThenObligation(between(page, 'async function deleteType', 'export default'))
    expect(page).toContain('eq(equipmentTypes.tenantId, ctx.tenantId)')
  })

  it('routes both PPE delete entrypoints through one locked lifecycle', () => {
    const lifecycle = source('./ppe-type-deletion.ts')
    const list = source('../app/(app)/ppe/types/page.tsx')
    const detail = source('../app/(app)/ppe/types/[id]/_actions.ts')

    const ownerLock = lifecycle.indexOf(".for('update')")
    const obligationCheck = lifecycle.indexOf('assertComplianceTargetCanRetire(')
    const usageCheck = lifecycle.indexOf('.from(ppeItems)')
    expect(ownerLock).toBeGreaterThanOrEqual(0)
    expect(obligationCheck).toBeGreaterThan(ownerLock)
    expect(usageCheck).toBeGreaterThan(obligationCheck)
    expect(lifecycle).toContain('eq(ppeTypes.tenantId, tenantId)')
    expect(lifecycle).toContain('eq(ppeItems.tenantId, tenantId)')

    for (const action of [list, detail]) {
      expect(action).toContain('deletePpeTypeInTransaction(tx, ctx.tenantId')
      expect(action).toContain('recordAuditInTransaction')
    }
  })

  it('keeps the existing document soft-delete protocol owner-first and tenant-scoped', () => {
    const deletion = source('./document-deletion.ts')
    expect(deletion.indexOf(".for('update')")).toBeLessThan(
      deletion.indexOf('.from(complianceObligations)'),
    )
    expect(deletion).toContain('eq(documents.tenantId, tenantId)')
    expect(deletion).toContain('eq(complianceObligations.tenantId, tenantId)')
    expect(deletion).toContain("eq(complianceObligations.status, 'active')")
    expect(deletion).toContain('isNull(complianceObligations.deletedAt)')
  })

  it('locks a document before blocking unpublish for a live obligation', () => {
    const page = source('../app/(app)/documents/[id]/page.tsx')
    const unpublish = between(page, 'async function unpublish', 'async function recordReviewAction')
    expectOwnerThenObligation(unpublish)
    expect(unpublish).toContain("assertComplianceTargetCanRetire(tx, ctx.tenantId, 'document', id)")
    expect(unpublish).toContain('eq(documents.tenantId, ctx.tenantId)')
  })
})
