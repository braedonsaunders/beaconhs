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

  it('only offers recording when the submit permission and item lifecycle allow it', () => {
    const page = source('../app/(app)/ppe/[id]/page.tsx')
    const actions = source('../app/(app)/ppe/_inspection-actions.ts')
    expect(page).toContain("const canInspect = can(ctx, 'ppe.inspect')")
    expect(page).toContain("(inspectionKind !== 'annual' || canManage)")
    expect(page).toContain('canRecordInspection && hasPreUse')
    expect(page).toContain('canRecordInspection && canManage && hasAnnual')
    expect(page).toContain('canRecordInspection && (hasPreUse || (canManage && hasAnnual))')
    expect(actions).toContain("if (kind === 'annual') assertCan(ctx, 'ppe.manage')")
    expect(actions).toContain("assertCan(ctx, 'ppe.inspect')")
    expect(actions).toContain('unstable_rethrow(error)')
  })

  it('validates the exact item, evidence, and tenant-owned uploads before writing', () => {
    const actions = source('../app/(app)/ppe/_inspection-actions.ts')
    expect(actions).toContain('if (!item || item.typeId !== typeId)')
    expect(actions).toContain('eq(attachments.uploadedBy, ctx.userId)')
    expect(actions).toContain("eq(attachments.kind, 'image')")
    expect(actions).toContain("if (c.requiresPhoto && answer !== 'n_a' && photoIds.length === 0)")
    expect(actions).toContain('.insert(ppeInspectionCriteria)')
    expect(actions).toContain('.insert(ppeInspectionAttachments)')
    expect(actions).toContain("status: 'submitted'")
    expect(actions).toContain("const finalResult: 'pass' | 'fail' | 'n_a'")
  })

  it('records other PPE pre-use only, with no item, status change, or corrective action', () => {
    const actions = source('../app/(app)/ppe/_inspection-actions.ts')
    const schema = source('../../../../packages/db/src/schema/ppe.ts')
    expect(actions).toContain("if (isOther && kind !== 'pre_use')")
    expect(actions).toContain('if (!isOther && shouldSpawnCorrectiveAction(answer, c.severity))')
    expect(actions).toContain('if (itemId && item) {')
    expect(actions).toContain('const nextDueOn = itemId ?')
    expect(schema).toContain("'ppe_inspections_target_ck'")
    expect(schema).toContain("typeId: uuid('type_id').notNull()")
    expect(schema).toContain("suppliedBy: text('supplied_by')")
  })

  it('keeps the saved checklist and photos visible from inspection history', () => {
    const page = source('../app/(app)/ppe/[id]/page.tsx')
    const drawer = source('../app/(app)/ppe/_inspection-detail-drawer.tsx')
    // The checklist opens in a drawer keyed by inspection id, so its evidence
    // is fetched for that one inspection instead of every row on the page.
    expect(page).toContain('drawer=inspection&inspectionId=')
    expect(page).toContain('<GeneratedText id="m_1045d684f7a2d8" />')
    expect(page).toContain('<PpeInspectionDetailDrawer')
    expect(page).toContain('itemId={id}')
    expect(drawer).toContain('itemId ? eq(ppeInspections.itemId, itemId) : undefined')
    expect(drawer).toContain('criterion.questionTextSnapshot')
    expect(drawer).toContain('criterion.nonComplianceReason')
    expect(drawer).toContain('<GeneratedText id="m_020f32bc59d098" />')
    expect(drawer).toContain('eq(ppeIssueReports.inspectionId, inspectionId)')
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
    expect(page).toContain('<GeneratedText id="m_1d05fa7a091a9b" />')
    expect(adapter).toContain('source_inspection_id: r.inspectionId ?? null')
    expect(adapter).toContain('r.reportedByNameSnapshot ?? head.reportedByName')
    expect(profiles).toContain("key: 'source_inspection_id'")
  })
})
