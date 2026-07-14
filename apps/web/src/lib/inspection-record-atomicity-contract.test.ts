import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function functionSlice(contents: string, name: string, next: string): string {
  const start = contents.indexOf(`function ${name}`)
  const end = contents.indexOf(next, start + 1)
  if (start < 0 || end < 0) throw new Error(`Could not locate ${name}`)
  return contents.slice(start, end)
}

const page = source('../app/(app)/inspections/records/[id]/page.tsx')
const recordActions = source('../app/(app)/inspections/records/_actions.ts')
const recordList = source('../app/(app)/inspections/records/page.tsx')
const recordExport = source('../app/(app)/inspections/export.csv/route.ts')
const recordPdf = source('../app/(app)/inspections/records/[id]/pdf/route.ts')
const inspectionLibrary = source('../app/(app)/inspections/_lib.ts')
const attachmentValidation = source('./attachment-validation.ts')
const apiWrites = source('./api/write.ts')
const dashboardMetrics = source('../app/(app)/dashboard/_metrics.ts')
const pickerOptions = source('../app/api/picker-options/route.ts')
const flowAdapter = source('./flows/adapters/inspections.ts')
const flowSamples = source('./flows/sample-record.ts')
const navRegistry = source('./nav/registry.ts')
const frontlineManual = source('./manual/content/frontline.ts')

describe('inspection record atomicity contract', () => {
  it('serializes every record mutation on a live tenant-owned parent row', () => {
    const lock = functionSlice(
      inspectionLibrary,
      'lockInspectionRecordForMutation',
      'export async function lockVisibleInspectionRecordForMutation',
    )
    expect(lock).toContain('eq(inspectionRecords.tenantId, tenantId)')
    expect(lock).toContain('eq(inspectionRecords.id, recordId)')
    expect(lock).toContain('isNull(inspectionRecords.deletedAt)')
    expect(lock).toContain(".for('update')")

    const visibilityLock = functionSlice(
      inspectionLibrary,
      'lockVisibleInspectionRecordForMutation',
      'export function parseAnswer',
    )
    expect(visibilityLock).toContain('lockInspectionRecordForMutation(')
    expect(visibilityLock).toContain('canSeeRecord(ctx, tx,')
    expect(visibilityLock).toContain('record.locked')
    expect(visibilityLock).toContain("record.status === 'closed'")

    const directActions = [
      ['updateStatus', 'async function toggleLock'],
      ['toggleLock', 'async function updateRecordField'],
      ['updateRecordField', 'async function setCriterionAnswer'],
      ['passAll', 'async function saveCustomerSignature'],
      ['saveCustomerSignature', '// Plain helper'],
      [
        'attachRecordPhotos',
        '// ----------------------------------------------------------------------------\n// Page',
      ],
    ] as const
    for (const [name, next] of directActions) {
      const action = functionSlice(page, name, next)
      expect(action, name).toContain('lockVisibleInspectionRecordForMutation(')
      expect(action, name).toContain('recordAuditInTransaction(')
    }

    const criterionActions = [
      ['setCriterionAnswer', 'async function setCriterionChoiceAnswer'],
      ['setCriterionChoiceAnswer', 'async function setCriterionValueAnswer'],
      ['setCriterionValueAnswer', 'async function setCriterionSeverity'],
      ['setCriterionSeverity', 'async function setCriterionNonCompliance'],
      ['setCriterionNonCompliance', 'async function setCriterionActionTaken'],
      ['setCriterionActionTaken', 'async function setCriterionCompliantNote'],
      ['setCriterionCompliantNote', 'async function setCriterionAssignment'],
      ['setCriterionAssignment', 'async function setCriterionCorrectedOn'],
      ['setCriterionCorrectedOn', 'async function addCriterionPhotos'],
      ['addCriterionPhotos', 'async function passAll'],
    ] as const
    for (const [name, next] of criterionActions) {
      const action = functionSlice(page, name, next)
      expect(action, name).toContain('withLockedCriterionMutation(')
      expect(action, name).toContain('eq(inspectionRecordCriteria.tenantId, ctx.tenantId)')
      expect(action, name).toContain('eq(inspectionRecordCriteria.recordId, recordId)')
      expect(action, name).toContain('eq(inspectionRecordCriteria.id, rowId)')
      expect(action, name).toContain('recordAuditInTransaction(')
    }
  })

  it('creates the parent, criteria, flow event, and audit in one transaction', () => {
    const uiCreate = functionSlice(recordActions, 'startInspection', '\n}')
    expect(uiCreate).toContain('const result = await ctx.db(async (tx) => {')
    expect(uiCreate).toContain('.insert(inspectionRecords)')
    expect(uiCreate).toContain('materialiseCriteriaForRecordInTx(')
    expect(uiCreate).toContain('recordModuleFlowEvent(tx, ctx,')
    expect(uiCreate).toContain('recordAuditInTransaction(tx, ctx,')
    expect(uiCreate).not.toContain('recordAudit(ctx,')

    const apiCreate = functionSlice(apiWrites, 'createInspection', 'function inspectionResult')
    expect(apiCreate).toContain('const row = await ctx.db(async (tx) => {')
    expect(apiCreate).toContain('.insert(inspectionRecords)')
    expect(apiCreate).toContain('materialiseCriteriaForRecordInTx(')
    expect(apiCreate).toContain('recordModuleFlowEvent(tx, ctx,')
    expect(apiCreate).toContain('recordAuditInTransaction(tx, ctx,')
    expect(apiCreate).not.toContain('recordAudit(ctx,')
  })

  it('uses one shared close gate and transaction-owned lifecycle effects in UI and API', () => {
    const uiStatus = functionSlice(page, 'updateStatus', 'async function toggleLock')
    const apiUpdate = functionSlice(
      apiWrites,
      'updateInspection',
      'async function deleteInspection',
    )
    const apiDelete = functionSlice(apiWrites, 'deleteInspection', 'const INSPECTION_BODY')

    for (const action of [uiStatus, apiUpdate]) {
      expect(action).toContain('assertInspectionStatusTransitionInTx(')
      expect(action).toContain('inspectionStatusMilestonePatch(')
      expect(action).toContain("event: 'status_change'")
      expect(action).toContain("event: 'on_submit'")
      expect(action).toContain('recordAuditInTransaction(')
    }
    for (const action of [apiUpdate, apiDelete]) {
      expect(action).toContain('lockInspectionRecordForMutation(')
      expect(action).toContain('eq(inspectionRecords.tenantId, ctx.tenantId)')
      expect(action).toContain('isNull(inspectionRecords.deletedAt)')
      expect(action).not.toContain('recordAudit(ctx,')
    }
  })

  it('denies navigation, list, detail, and PDF access without an inspections read tier', () => {
    const inspectionNav = navRegistry.slice(
      navRegistry.indexOf("key: 'inspections'"),
      navRegistry.indexOf("key: 'hazid'"),
    )
    expect(inspectionNav).toContain("requiredPermission: 'inspections.read.self'")
    expect(recordList).toContain("assertCan(ctx, 'inspections.read.self')")
    expect(page).toContain("assertCan(ctx, 'inspections.read.self')")
    expect(recordPdf).toContain("assertCan(ctx, 'inspections.read.self')")
    const inspectionGuide = frontlineManual.slice(
      frontlineManual.indexOf("slug: 'inspections'"),
      frontlineManual.indexOf("slug: 'incidents'"),
    )
    expect(inspectionGuide).toContain("requiredPermission: 'inspections.read.self'")
  })

  it('cannot leave an incomplete editable record marked submitted', () => {
    const mutationWrapper = functionSlice(
      page,
      'withLockedCriterionMutation',
      'async function markInspectionInProgressIfDraft',
    )
    expect(mutationWrapper).toContain('reconcileSubmittedInspectionInTx(tx, ctx, record)')

    const reconcile = functionSlice(
      inspectionLibrary,
      'reconcileSubmittedInspectionInTx',
      'export class InspectionTransitionError',
    )
    expect(reconcile).toContain("record.status !== 'submitted'")
    expect(reconcile).toContain('findIncompleteCriteriaInTx(')
    expect(reconcile).toContain('eq(inspectionRecords.tenantId, ctx.tenantId)')
    expect(reconcile).toContain("eq(inspectionRecords.status, 'submitted')")
    expect(reconcile).toContain("toStatus: 'in_progress'")
    expect(reconcile).toContain('materializeEvidenceTargetObligations(')
    expect(reconcile).toContain('recordAuditInTransaction(')
  })

  it('publishes and audits the automatic draft-to-in-progress transition', () => {
    const startWork = functionSlice(
      page,
      'markInspectionInProgressIfDraft',
      'async function updateStatus',
    )
    expect(startWork).toContain("record.status !== 'draft'")
    expect(startWork).toContain("eq(inspectionRecords.status, 'draft')")
    expect(startWork).toContain("toStatus: 'in_progress'")
    expect(startWork).toContain('recordAuditInTransaction(')
  })

  it('reopens closed records instead of permitting a closed-unlocked state', () => {
    expect(page).toContain("const recordImmutable = record.locked || record.status === 'closed'")
    const toggle = functionSlice(page, 'toggleLock', 'async function updateRecordField')
    expect(toggle).toContain("current.status === 'closed' && !lock")
    expect(toggle).toContain("inspectionStatusMilestonePatch(current, 'submitted'")
    expect(toggle).toContain("toStatus: 'submitted'")
    expect(toggle).toContain('materializeEvidenceTargetObligations(')

    const apiUpdate = functionSlice(
      apiWrites,
      'updateInspection',
      'async function deleteInspection',
    )
    const apiDelete = functionSlice(apiWrites, 'deleteInspection', 'const INSPECTION_BODY')
    for (const action of [apiUpdate, apiDelete]) {
      expect(action).toContain("before.locked || before.status === 'closed'")
    }
  })

  it('validates and de-duplicates photos and retires superseded signatures atomically', () => {
    const criterionPhotos = functionSlice(page, 'addCriterionPhotos', 'async function passAll')
    const recordPhotos = functionSlice(
      page,
      'attachRecordPhotos',
      '// ----------------------------------------------------------------------------\n// Page',
    )
    for (const action of [criterionPhotos, recordPhotos]) {
      expect(action).toContain('validateInspectionPhotoAttachmentIdsInTx(')
      expect(action).toContain('new Set(')
      expect(action).toContain('recordAuditInTransaction(')
    }

    const validation = functionSlice(
      attachmentValidation,
      'validateTenantImageAttachmentIdsInTx',
      '\n}',
    )
    expect(validation).toContain('eq(attachments.tenantId, tenantId)')
    expect(validation).toContain("eq(attachments.kind, 'image')")
    expect(validation).toContain('rows.length !== uniqueIds.length')
    expect(validation).toContain(".for('share')")

    const signature = functionSlice(page, 'saveCustomerSignature', '// Plain helper')
    expect(signature).toContain('withStoredSignatureAttachment(')
    expect(signature).toContain('lockVisibleInspectionRecordForMutation(')
    expect(signature).toContain('.delete(attachments)')
    expect(signature).toContain("eq(attachments.kind, 'signature')")
    expect(signature).toContain('recordAuditInTransaction(')
  })

  it('keeps corrective-action synchronization inside the caller transaction', () => {
    const sync = functionSlice(
      inspectionLibrary,
      'syncCorrectiveActionForCriterionInTx',
      'async function findIncompleteCriteriaInTx',
    )
    expect(sync).not.toContain('ctx.db(')
    expect(sync).toContain('eq(inspectionRecordCriteria.tenantId, ctx.tenantId)')
    expect(sync).toContain('eq(inspectionRecordCriteria.recordId, recordId)')
    expect(sync).toContain('recordDomainEvent(tx,')
    expect(sync).toContain("eventType: 'corrective_action.created'")
    expect(sync).toContain('correctiveActionCreatedEvent(')
    expect(sync).toContain('materializeEvidenceTargetObligations(')
    expect(sync).toContain('recordAuditInTransaction(')
    expect(sync).toContain(".for('update')")
    expect(sync).not.toContain('recordAudit(ctx,')
  })

  it('has no residual unscoped or post-commit inspection writer patterns', () => {
    expect(page).not.toContain('assertCanSeeInspection')
    expect(page).not.toContain('logRecordAudit')
    expect(page).not.toMatch(/\.where\(\s*eq\(inspectionRecords\.id/)
    expect(page).not.toMatch(/\.where\(\s*eq\(inspectionRecordCriteria\.id/)
    expect(inspectionLibrary).not.toContain('logRecordAudit')
    expect(inspectionLibrary).not.toContain('recordAudit(ctx,')
  })

  it('excludes archived records from every inspections-module live reader', () => {
    expect(recordList).toContain(
      'const filters: SQL<unknown>[] = [isNull(inspectionRecords.deletedAt)]',
    )
    expect(recordList).toContain('.where(and(vis, isNull(inspectionRecords.deletedAt)))')
    expect(recordExport).toContain(
      'const filters: SQL<unknown>[] = [isNull(inspectionRecords.deletedAt)]',
    )
    for (const detail of [page, recordPdf]) {
      expect(detail).toContain('eq(inspectionRecords.tenantId, ctx.tenantId)')
      expect(detail).toContain('isNull(inspectionRecords.deletedAt)')
    }
    expect(dashboardMetrics).toMatch(
      /isNull\(inspectionRecords\.deletedAt\)[\s\S]*gte\(inspectionRecords\.occurredAt, startOfMonth\)/,
    )
    expect(
      pickerOptions.match(/and\(scope, isNull\(inspectionRecords\.deletedAt\), match\)/g),
    ).toHaveLength(3)
    expect(flowAdapter.match(/isNull\(inspectionRecords\.deletedAt\)/g)).toHaveLength(2)
    expect(flowAdapter).toContain('eq(inspectionRecords.tenantId, ctx.tenantId)')
    expect(flowSamples).toContain('liveWhere: isNull(inspectionRecords.deletedAt)')
  })
})
