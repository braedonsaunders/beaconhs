import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('PPE inspection evidence cutover contract', () => {
  it('persists immutable checklist snapshots and normalized photos', () => {
    const schema = source('../../../../packages/db/src/schema/ppe.ts')
    expect(schema).toContain("'ppe_inspection_criteria'")
    expect(schema).toContain("questionTextSnapshot: text('question_text_snapshot').notNull()")
    expect(schema).toContain("'ppe_inspection_attachments'")
    expect(schema).toContain("name: 'ppe_inspection_attachments_tenant_criterion_fk'")
    expect(schema).toContain("'ppe_inspection_attachments_exactly_one_owner_ck'")
    expect(schema).toContain("status: ppeInspectionStatus('status').default('submitted').notNull()")
    expect(schema).toContain("'ppe_inspections_submitted_result_ck'")
  })

  it('validates the exact item, evidence, and tenant-owned uploads before writing', () => {
    const page = source('../app/(app)/ppe/[id]/page.tsx')
    expect(page).toContain('if (!item || item.typeId !== typeId)')
    expect(page).toContain('eq(attachments.uploadedBy, ctx.userId)')
    expect(page).toContain("eq(attachments.kind, 'image')")
    expect(page).toContain("if (c.requiresPhoto && answer !== 'n_a' && photoIds.length === 0)")
    expect(page).toContain('.insert(ppeInspectionCriteria)')
    expect(page).toContain('.insert(ppeInspectionAttachments)')
    expect(page).toContain("status: 'submitted'")
    expect(page).toContain("const finalResult: 'pass' | 'fail' | 'n_a'")
  })

  it('keeps the saved checklist and photos visible from inspection history', () => {
    const page = source('../app/(app)/ppe/[id]/page.tsx')
    expect(page).toContain('View checklist (')
    expect(page).toContain('criterion.questionTextSnapshot')
    expect(page).toContain('criterion.nonComplianceReason')
    expect(page).toContain('General inspection photos')
  })

  it('exposes checklist evidence to PPE email and PDF templates', () => {
    const adapter = source('./flows/adapters/ppe.ts')
    const profiles = source('./flows/module-profiles.ts')
    expect(adapter).toContain('ppeInspectionCriteria.questionTextSnapshot')
    expect(adapter).toContain('ppeInspectionAttachments.caption')
    expect(adapter).toContain('criteria: criteria.map')
    expect(adapter).toContain('photos: await Promise.all')
    expect(profiles).toContain("key: 'criteria'")
    expect(profiles).toContain("key: 'photos'")
  })

  it('preserves PPE defect provenance and scopes resolution to the owning item', () => {
    const schema = source('../../../../packages/db/src/schema/ppe.ts')
    const page = source('../app/(app)/ppe/[id]/page.tsx')
    const adapter = source('./flows/adapters/ppe-issues.ts')
    const profiles = source('./flows/module-profiles.ts')
    expect(schema).toContain("inspectionId: uuid('inspection_id')")
    expect(schema).toContain("reportedByNameSnapshot: text('reported_by_name_snapshot')")
    expect(schema).toContain("source: text('source').default('manual').notNull()")
    expect(schema).toContain("name: 'ppe_issue_reports_tenant_inspection_fk'")
    expect(page).toContain('eq(ppeIssueReports.itemId, itemId)')
    expect(page).toContain("source: 'manual'")
    expect(page).toContain('<TableHead>Source</TableHead>')
    expect(adapter).toContain('source_inspection_id: r.inspectionId ?? null')
    expect(adapter).toContain('r.reportedByNameSnapshot ?? head.reportedByName')
    expect(profiles).toContain("key: 'source_inspection_id'")
  })
})
