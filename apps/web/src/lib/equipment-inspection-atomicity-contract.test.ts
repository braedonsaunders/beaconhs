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

const actions = source('../app/(app)/equipment/inspections/_actions.ts')
const library = source('../app/(app)/equipment/inspections/_lib.ts')
const detail = source('../app/(app)/equipment/inspections/[id]/page.tsx')
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
      'export async function lockVisibleEquipmentInspectionForMutation',
    )
    expect(lock).toContain('eq(equipmentInspectionRecords.tenantId, tenantId)')
    expect(lock).toContain('isNull(equipmentInspectionRecords.deletedAt)')
    expect(lock).toContain(".for('update')")

    const visibleLock = functionSlice(
      library,
      'lockVisibleEquipmentInspectionForMutation',
      'export function parseEqAnswer',
    )
    expect(visibleLock).toContain('canSeeRecord(ctx, tx,')
    expect(visibleLock).toContain('record.locked')
    expect(visibleLock).toContain("record.status === 'submitted'")
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
    expect(submit).toContain('record.isPreUse')
    expect(submit).not.toContain('.from(equipmentInspectionTypes)')
    expect(submit).toContain("nextReference(tx, ctx.tenantId, 'work_order'")
    expect(submit).toContain('recordModuleFlowEvent(tx, ctx,')
    expect(submit).toContain('recordAuditInTransaction(tx, ctx,')
    expect(submit).toContain('materializeEquipmentTypeEvidence(')

    const passAll = functionSlice(
      actions,
      'passAllEquipmentInspection',
      '// --- record-level live fields',
    )
    expect(passAll).toContain('record.allowPassAll')
    expect(passAll).not.toContain('.from(equipmentInspectionTypes)')
  })

  it('validates criterion semantics and audits every changed autosave in its lock transaction', () => {
    const answer = functionSlice(actions, 'setAnswer', 'export async function setSeverity')
    expect(answer).toContain('withLockedCriterionMutation(')
    expect(answer).toContain("criterion.kind !== 'pass_fail'")
    expect(answer).toContain("answer === 'n_a'")
    expect(answer).toContain('recordAuditInTransaction(tx, ctx,')

    const value = functionSlice(actions, 'setValue', 'export async function addCriterionPhotos')
    expect(value).toContain("criterion.kind !== 'text'")
    expect(value).toContain('normalizeInspectionNumberAnswer(')
    expect(value).toContain('normalizeInspectionTextAnswer(')
    expect(value).not.toContain("formData.get('kind')")
    expect(value).toContain('recordAuditInTransaction(tx, ctx,')

    const finding = functionSlice(actions, 'setFindingText', 'export async function setComment')
    expect(finding).toContain("criterion.answer !== 'fail'")
    expect(finding).toContain('recordAuditInTransaction(tx, ctx,')
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
    expect(reopen).toContain('materializeEquipmentTypeEvidence(')
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
    // The eligible checks are fetched per item and rendered as one-tap cards,
    // matching the hazard-assessment start flyout — not a free-text dropdown.
    expect(newDrawer).toContain("params.set('contextId', contextId)")
    expect(newDrawer).toContain('/api/picker-options?')
    expect(actions).toContain("targetMode === 'rental'")
    // Server-side the same two rules are enforced, not just hinted at in the UI.
    expect(actions).toContain("item.ownership === 'rented' && !type.isPreUse")
    expect(actions).toContain('That inspection is not set up on this equipment item')
    expect(library).toContain('record.isRental && fails.length > 0')
    expect(library).toContain("sourceEntityType: 'equipment_inspection_record'")
  })
})
