import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start)
  const endIndex = end ? value.indexOf(end, startIndex + start.length) : value.length
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return value.slice(startIndex, endIndex)
}

const typeEvidence = source('./compliance-type-evidence.ts')
const equipmentDetail = source('../app/(app)/equipment/[id]/page.tsx')
const equipmentBulk = source('../app/(app)/equipment/_actions.ts')
const equipmentSchedules = source('../app/(app)/equipment/_maintenance-actions.ts')
const equipmentInspections = source('../app/(app)/equipment/inspections/_lib.ts')
const ppeDetail = source('../app/(app)/ppe/[id]/page.tsx')
const ppeBulk = source('../app/(app)/ppe/_actions.ts')
const ppeLifecycle = source('../app/(app)/ppe/_lib.ts')
const api = source('./api/write.ts')

describe('equipment and PPE compliance evidence lifecycle', () => {
  it('centralizes deterministic type-target fan-out for both evidence families', () => {
    expect(typeEvidence).toContain('materializeEvidenceTargetsObligations(')
    expect(typeEvidence).toContain("sourceModule: 'equipment_inspection' as const")
    expect(typeEvidence).toContain('targetRef: { equipmentTypeId }')
    expect(typeEvidence).toContain("sourceModule: 'ppe_inspection' as const")
    expect(typeEvidence).toContain('targetRef: { ppeTypeId }')
  })

  it('refreshes equipment draft finalization, type/status edits, and bulk status atomically', () => {
    const update = between(
      equipmentDetail,
      'async function updateEquipmentField',
      'async function reportMissing',
    )
    const bulkStatus = between(
      equipmentBulk,
      'export async function bulkSetEquipmentStatus',
      'export async function bulkExportEquipmentCsv',
    )

    expect(update).toContain(".for('update')")
    expect(update).toContain("prior.isDraft || field === 'status' || field === 'typeId'")
    expect(update).toContain('await recordAuditInTransaction(tx, ctx')
    expect(update).toContain('await materializeEquipmentTypeEvidence(tx, ctx.tenantId')
    expect(bulkStatus).toContain('await materializeEquipmentTypeEvidence(')
  })

  it('serializes schedule writes and inspection submission with their equipment refresh', () => {
    const save = between(
      equipmentSchedules,
      'export async function saveEquipmentSchedule',
      'export async function deleteEquipmentSchedule',
    )
    const remove = between(
      equipmentSchedules,
      'export async function deleteEquipmentSchedule',
      '// --- reminders',
    )
    const finalize = between(
      equipmentInspections,
      'export async function finaliseEquipmentInspection',
      '',
    )

    for (const mutation of [save, remove, finalize]) {
      expect(mutation).toContain(".for('update')")
      expect(mutation).toContain('await materializeEquipmentTypeEvidence(tx, ctx.tenantId')
    }
    expect(save).toContain('await recordAuditInTransaction(tx, ctx')
    expect(remove).toContain('await recordAuditInTransaction(tx, ctx')
  })

  it('refreshes PPE field, inspection, status, and certificate evidence in locked transactions', () => {
    const update = between(
      ppeDetail,
      'async function updatePpeField',
      'async function recordInspection',
    )
    const inspection = between(
      ppeDetail,
      'async function recordInspection',
      'async function setStatus',
    )
    const status = between(ppeDetail, 'async function setStatus', 'async function reportIssue')
    const certificate = between(
      ppeDetail,
      'async function addCertificate',
      'async function sendEmailAction',
    )

    for (const mutation of [update, inspection, status, certificate]) {
      expect(mutation).toContain(".for('update')")
      expect(mutation).toContain('await materializePpeTypeEvidence(tx, ctx.tenantId')
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
    }
    expect(update).toContain("field === 'expiresOn' || field === 'typeId'")
  })

  it('keeps PPE custody, registration, bulk removal, and API evidence complete', () => {
    const custody = between(
      ppeLifecycle,
      'export async function recordPpeIssueAction',
      'export async function loadInspectionCriteriaForType',
    )
    const create = between(ppeBulk, 'export async function createAndIssuePpe', '')
    const discard = between(
      ppeBulk,
      'export async function bulkDiscardPpe',
      'export async function bulkExportPpeCsv',
    )
    const apiEquipment = between(api, 'async function createEquipment', 'const EQUIPMENT_BODY')
    const apiPpe = between(api, 'async function createPpe', 'const PPE_BODY')

    expect(custody).toContain(".for('update')")
    expect(custody).toContain('Discarded or expired PPE cannot be issued.')
    expect(custody).toContain("sourceModule: 'ppe_inspection'")
    expect(custody).toContain('await recordAuditInTransaction(tx, ctx')
    for (const mutation of [create, discard, apiEquipment, apiPpe]) {
      expect(mutation).toMatch(/materialize(?:Equipment|Ppe)TypeEvidence\(/u)
    }
    expect(create).toContain('.insert(ppeIssues)')
    expect(create).toContain('await recordAuditInTransaction(tx, ctx')
  })
})
