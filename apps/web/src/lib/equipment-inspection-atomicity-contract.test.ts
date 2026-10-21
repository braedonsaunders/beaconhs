import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function sliceBetween(contents: string, start: string, end: string): string {
  const from = contents.indexOf(start)
  const to = contents.indexOf(end, from + 1)
  if (from < 0 || to < 0) throw new Error(`Could not locate ${start}`)
  return contents.slice(from, to)
}

function functionSlice(contents: string, name: string, next: string): string {
  const start = contents.indexOf(`function ${name}`)
  const end = contents.indexOf(next, start + 1)
  if (start < 0 || end < 0) throw new Error(`Could not locate ${name}`)
  return contents.slice(start, end)
}

const actions = source('../app/(app)/equipment/inspections/_actions.ts')
const recordEdits = source('../app/(app)/equipment/inspections/_record-edits.ts')
const criterionCard = source('../app/(app)/equipment/inspections/[id]/_criteria.tsx')
const library = source('../app/(app)/equipment/inspections/_lib.ts')
// The record is filled in a flyout on the register; [id] is only a redirect
// for old deep links, so the queries live in the panel.
const detail = source('../app/(app)/equipment/inspections/_inspection-panel.tsx')
const list = source('../app/(app)/equipment/inspections/page.tsx')
const newPage = source('../app/(app)/equipment/inspections/new/page.tsx')
const newDrawer = source('../app/(app)/equipment/inspections/_new-drawer.tsx')
const schema = source('../../../../packages/db/src/schema/equipment-inspection-records.ts')
const flow = source('./flows/adapters/equipment-inspections.ts')
const samples = source('./flows/sample-record.ts')
const attachmentValidation = source('./attachment-validation.ts')

describe('equipment inspection atomicity contract', () => {
  it('serializes mutations on a visible live tenant parent', () => {
    const lock = functionSlice(
      library,
      'lockEquipmentInspectionRecordForMutation',
      'export async function lockVisibleEquipmentInspection(',
    )
    expect(lock).toContain('eq(equipmentInspectionRecords.tenantId, tenantId)')
    expect(lock).toContain('isNull(equipmentInspectionRecords.deletedAt)')
    expect(lock).toContain(".for('update')")

    const visibleLock = functionSlice(
      library,
      'lockVisibleEquipmentInspection(',
      'export function equipmentInspectionIsFinalized',
    )
    expect(visibleLock).toContain('lockEquipmentInspectionRecordForMutation(')
    expect(visibleLock).toContain('canSeeRecord(ctx, tx,')
    const finalized = functionSlice(
      library,
      'equipmentInspectionIsFinalized',
      'export const EQUIPMENT_INSPECTION_FINALIZED_MESSAGE',
    )
    expect(finalized).toContain('record.locked')
    expect(finalized).toContain("record.status === 'submitted'")
    const mutationLock = functionSlice(
      library,
      'lockVisibleEquipmentInspectionForMutation',
      'export async function lockEquipmentInspectionCriterionForMutation',
    )
    expect(mutationLock).toContain('lockVisibleEquipmentInspection(tx, ctx, recordId)')
    expect(mutationLock).toContain('equipmentInspectionIsFinalized(record)')
    const criterionLock = functionSlice(
      library,
      'lockEquipmentInspectionCriterionForMutation',
      'export async function markEquipmentInspectionInProgressIfDraft',
    )
    expect(criterionLock).toContain('eq(equipmentInspectionRecordCriteria.tenantId, tenantId)')
    expect(criterionLock).toContain('eq(equipmentInspectionRecordCriteria.recordId, recordId)')
    expect(criterionLock).toContain(".for('update')")
    expect(actions).not.toContain('editableContext')
    expect(actions).not.toContain('recordEditable')
  })

  it('creates parent, immutable snapshots, criteria, and audit in one transaction', () => {
    const create = functionSlice(actions, 'startEquipmentInspection', '// --- per-criterion')
    expect(create).toContain('const row = await ctx.db(async (tx) => {')
    expect(create).toContain('nextEquipmentInspectionReferenceInTx(')
    expect(create).toContain('.insert(equipmentInspectionRecords)')
    expect(create).toContain('allowPassAll: type.allowPassAll')
    expect(create).toContain(
      "failsSpawnWorkOrders: targetMode === 'registered' && type.failsSpawnWorkOrders",
    )
    expect(create).toContain('isPreUse: type.isPreUse')
    expect(create).toContain('intervalValue: type.intervalValue')
    expect(create).toContain('intervalUnit: type.intervalUnit')
    expect(create).toContain('materialiseEquipmentCriteriaInTx(')
    expect(create).toContain('recordAuditInTransaction(tx, ctx,')
    expect(create).not.toContain('recordAudit(ctx,')
  })

  it('physically stores every template behavior and required criterion snapshot', () => {
    for (const column of [
      "intervalValue: integer('interval_value')",
      "intervalUnit: equipmentIntervalUnit('interval_unit')",
      "isPreUse: boolean('is_pre_use')",
      "allowPassAll: boolean('allow_pass_all')",
      "failsSpawnWorkOrders: boolean('fails_spawn_work_orders')",
      "equipmentNameSnapshot: text('equipment_name_snapshot')",
      "rentalProvider: text('rental_provider')",
      "isRequired: boolean('is_required')",
    ]) {
      expect(schema).toContain(column)
    }
    expect(library).toContain('isRequired: r.criterion.isRequired')
    expect(library).toContain('row.isRequired && !hasValue(row)')
    expect(schema).toContain('equipment_inspection_records_target_mode_ck')
  })

  it('submits exclusively from record snapshots, even if the source type changes or disappears', () => {
    const submit = functionSlice(library, 'finaliseEquipmentInspection', '\n}')
    expect(submit).toContain('record.failsSpawnWorkOrders')
    expect(submit).toContain('record.intervalValue')
    expect(submit).toContain('record.intervalUnit')
    expect(submit).toContain('reconcileEquipmentInspectionDatesInTx(tx, ctx.tenantId, item.id)')
    const reconcile = library.slice(
      library.indexOf('export async function reconcileEquipmentInspectionDatesInTx'),
    )
    expect(reconcile).toContain('eq(equipmentInspectionRecords.isPreUse, true)')
    expect(reconcile).toContain(
      "inArray(equipmentInspectionRecords.status, ['submitted', 'closed'])",
    )
    expect(reconcile).toContain('isNull(equipmentInspectionRecords.deletedAt)')
    expect(reconcile).not.toContain('.from(equipmentInspectionTypes)')
    expect(submit).not.toContain('.from(equipmentInspectionTypes)')
    expect(submit).toContain("nextReference(tx, ctx.tenantId, 'work_order'")
    expect(submit).toContain('recordModuleFlowEvent(tx, ctx,')
    expect(submit).toContain('recordAuditInTransaction(tx, ctx,')

    const passAll = functionSlice(actions, 'passAllEquipmentInspection', '// --- submit / reopen')
    expect(passAll).toContain('record.allowPassAll')
    expect(passAll).not.toContain('.from(equipmentInspectionTypes)')
  })

  it('validates criterion semantics and audits every synced edit in its lock transaction', () => {
    expect(recordEdits).toContain("authorize: (ctx) => can(ctx, 'equipment.inspect')")
    const load = sliceBetween(recordEdits, 'async load(tx, ctx, recordId)', 'async resolve(')
    expect(load).toContain('lockVisibleEquipmentInspection(tx, ctx, recordId)')
    expect(load).toContain('throw recordNotFound()')
    expect(load).toContain('equipmentInspectionIsFinalized(record)')
    expect(load).toContain('throw recordLocked(')

    const lookup = functionSlice(recordEdits, 'criterionForEdit(', 'function criterionFieldOp')
    expect(lookup).toContain('lockEquipmentInspectionCriterionForMutation(')
    expect(lookup).toContain('edits.record.id')
    const write = functionSlice(recordEdits, 'criterionFieldOp(', 'switch (field)')
    expect(write).toContain('eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId)')
    expect(write).toContain('eq(equipmentInspectionRecordCriteria.recordId, criterion.recordId)')
    expect(write).toContain("criterion.answer !== 'fail'")

    const answer = sliceBetween(recordEdits, "case 'answer':", "case 'severity':")
    expect(answer).toContain("criterion.kind !== 'pass_fail'")
    expect(answer).toContain("answer === 'n_a'")
    expect(answer).toContain('comment: null, actionTaken: null, correctedOn: null')

    const value = sliceBetween(
      recordEdits,
      "case 'value':",
      'export const equipmentInspectionRecordSaver',
    )
    expect(value).toContain("criterion.kind !== 'text'")
    expect(value).toContain('parseInspectionNumberAnswer(')
    expect(value).toContain('normalizeInspectionTextAnswer(')

    const finding = sliceBetween(recordEdits, "case 'comment':", "case 'value':")
    expect(finding).toContain('requireFail(')

    // A pass or N/A clears the finding text on the device too.
    const pickAnswer = functionSlice(criterionCard, 'pickAnswer', 'function pickSeverity')
    expect(pickAnswer).toContain("commentField.commit('')")
    expect(pickAnswer).toContain("actionTakenField.commit('')")

    const site = sliceBetween(recordEdits, "case 'siteOrgUnitId':", "case 'hours':")
    expect(site).toContain('eq(orgUnits.tenantId, ctx.tenantId)')
    expect(site).toContain('isNull(orgUnits.deletedAt)')

    const afterWrites = sliceBetween(recordEdits, 'async afterWrites(', 'revalidate:')
    expect(afterWrites).toContain('recordAuditInTransaction(tx, ctx,')
    expect(afterWrites).toContain("entityType: 'equipment_inspection_record'")
    expect(afterWrites).toContain('syncInspectionHoursInTx(tx, ctx, record)')
    expect(afterWrites).toContain('markEquipmentInspectionInProgressIfDraft(tx, ctx, record)')
  })

  it('validates, tenant-scopes, kind-checks, and de-duplicates photo ids', () => {
    const photos = functionSlice(
      actions,
      'addCriterionPhotos',
      'export async function passAllEquipmentInspection',
    )
    expect(photos).toContain('validateTenantImageAttachmentIdsInTx(')
    expect(photos).toContain('new Set(')
    expect(photos).toContain('recordAuditInTransaction(tx, ctx,')

    const validator = functionSlice(
      attachmentValidation,
      'validateTenantImageAttachmentIdsInTx',
      '\n}',
    )
    expect(validator).toContain('eq(attachments.tenantId, tenantId)')
    expect(validator).toContain("eq(attachments.kind, 'image')")
    expect(validator).toContain(".for('share')")
  })

  it('reopens the complete lifecycle and compliance state atomically', () => {
    const reopen = functionSlice(actions, 'reopenEquipmentInspection', '\n}')
    expect(reopen).toContain('lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId,')
    expect(reopen).toContain("status: 'in_progress'")
    expect(reopen).toContain('result: null')
    expect(reopen).toContain('submittedAt: null')
    expect(reopen).toContain('submittedByTenantUserId: null')
    expect(reopen).toContain('closedAt: null')
    expect(reopen).toContain('closedByTenantUserId: null')
    expect(reopen).toContain('locked: false')
    expect(reopen).toContain('recordAuditInTransaction(tx, ctx,')
  })

  it('tenant-scopes every reader and preserves both imported and runtime evidence', () => {
    expect(list).toContain("assertCan(ctx, 'equipment.read.self')")
    expect(list).toContain('eq(equipmentInspectionRecords.tenantId, ctx.tenantId)')
    expect(list).toContain("{ value: 'closed', label: 'Closed' }")
    expect(detail).toContain("assertCan(ctx, 'equipment.read.self')")
    expect(detail).toContain('eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId)')
    expect(detail).toContain('equipmentInspectionRecordAttachments')
    expect(detail).toContain("eq(attachments.kind, 'image')")
    expect(flow).toContain('eq(equipmentInspectionRecords.tenantId, ctx.tenantId)')
    expect(flow).toContain('criterion.photoAttachmentIds')
    expect(flow).toContain('equipmentInspectionRecordAttachments')
    expect(samples).toContain("'equipment-inspections':")
    expect(samples).toContain('isNull(equipmentInspectionRecords.deletedAt)')
  })

  it('uses bounded permission-aware equipment and type pickers on creation', () => {
    // Creation happens in a flyout; the old full page is a redirect shim that
    // must never write, so it holds no query at all.
    expect(newPage).not.toContain('.orderBy(asc(')
    expect(newPage).toContain('redirect(')
    expect(newDrawer).toContain('lookup="equipment-inspection-items"')
    // A registered unit inherits its inspections — the picker is scoped to the
    // ITEM's own pre-use checklist and schedules, not the tenant catalogue.
    expect(newDrawer).toContain("'equipment-item-scheduled-inspection-types'")
    // Unregistered rental gear is pre-use only.
    expect(newDrawer).toContain("'equipment-rental-inspection-types'")
    expect(newDrawer).toContain('lookup="equipment-inspection-sites"')
    // The shared picker searches all eligible rows on the server.
    expect(newDrawer).toContain('lookup={lookup}')
    expect(newDrawer).toContain('contextId={contextId || undefined}')
    expect(newDrawer).not.toContain('choices.filter(')
    expect(actions).toContain("targetMode === 'rental' && !type.isPreUse")
    expect(actions).toContain("targetMode === 'rental'")
    // Server-side the same two rules are enforced, not just hinted at in the UI.
    expect(actions).toContain("item.ownership === 'rented' && !type.isPreUse")
    expect(actions).toContain('That inspection is not set up on this equipment item')
    expect(library).toContain('record.isRental && fails.length > 0')
    expect(library).toContain("sourceEntityType: 'equipment_inspection_record'")
  })
})
