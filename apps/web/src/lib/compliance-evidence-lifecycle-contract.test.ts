import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return value.slice(startIndex, endIndex)
}

const acknowledgments = source('../app/(app)/documents/[id]/_ack-actions.ts')
const documentPage = source('../app/(app)/documents/[id]/page.tsx')
const documentMaster = source('../app/(app)/documents/[id]/_master-actions.ts')
const inspectionPage = source('../app/(app)/inspections/records/[id]/page.tsx')
const apiWrites = source('./api/write.ts')
const journalActions = source('../app/(app)/journals/_actions.ts')
const hazardActions = source('../app/(app)/hazard-assessments/_actions.ts')
const hazardSignatureMigration = source(
  '../../../../packages/db/drizzle/0008_hazid_review_conditions_signatures.sql',
)

describe('immediate compliance evidence lifecycle', () => {
  it('materializes document acknowledgments and signer removals in their write transaction', () => {
    expect(acknowledgments.match(/await materializeEvidenceTargetObligations\(tx/gu)).toHaveLength(
      3,
    )
    expect(acknowledgments).toContain("sourceModule: 'document'")
    expect(acknowledgments).toContain('targetRef: { documentId }')
  })

  it('materializes both uploaded-PDF and authored-document publication atomically', () => {
    const publishFile = between(
      documentPage,
      'async function publishFileDocument',
      'async function unpublish',
    )
    const publishAuthored = between(
      documentMaster,
      'export async function publishDocumentVersion',
      "summary: 'Published a new version'",
    )
    for (const mutation of [publishFile, publishAuthored]) {
      expect(mutation).toContain('await ctx.db(async (tx) =>')
      expect(mutation).toContain('await materializeEvidenceTargetObligations(tx')
      expect(mutation).toContain("sourceModule: 'document'")
    }
  })

  it('materializes inspection status, occurrence, inspector, and archive changes atomically', () => {
    const updateStatus = between(
      inspectionPage,
      'async function updateStatus',
      'async function toggleLock',
    )
    const updateField = between(
      inspectionPage,
      'async function updateRecordField',
      'async function setCriterionAnswer',
    )
    const apiUpdate = between(
      apiWrites,
      'async function updateInspection',
      'async function deleteInspection',
    )
    const apiDelete = between(apiWrites, 'async function deleteInspection', 'const INSPECTION_BODY')

    expect(updateStatus).toContain('await materializeEvidenceTargetObligations(tx')
    expect(updateField).toContain("if (field === 'occurredAt')")
    expect(updateField).toContain('await materializeEvidenceTargetObligations(tx')
    expect(apiUpdate).toContain("hasOwn(b, 'inspectorTenantUserId')")
    expect(apiUpdate).toContain('await materializeEvidenceTargetObligations(tx')
    expect(apiDelete).toContain('await materializeEvidenceTargetObligations(tx')
    for (const mutation of [updateStatus, updateField, apiUpdate, apiDelete]) {
      expect(mutation).toContain("sourceModule: 'inspection'")
      expect(mutation).toContain('inspectionTypeId')
    }
  })

  it('materializes journal date, submit, and delete evidence with the audit transaction', () => {
    const update = between(
      journalActions,
      'export async function updateEntry',
      'export async function submitEntry',
    )
    const submit = between(
      journalActions,
      'export async function submitEntry',
      'export async function deleteEntry',
    )
    const remove = between(journalActions, 'export async function deleteEntry', '// ---- AI')

    expect(update).toContain('if (values.entryDate !== undefined)')
    for (const mutation of [update, submit, remove]) {
      expect(mutation).toContain('await materializeEvidenceTargetObligations(tx')
      expect(mutation).toContain("sourceModule: 'journal'")
    }
    for (const mutation of [submit, remove]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).not.toContain('await recordAudit(ctx')
    }
  })

  it('materializes completed hazard-assessment lifecycle changes atomically', () => {
    const lock = between(
      hazardActions,
      'export async function lockAssessment',
      'export async function unlockAssessment',
    )
    const unlock = between(
      hazardActions,
      'export async function unlockAssessment',
      'export async function deleteAssessment',
    )
    const remove = between(
      hazardActions,
      'export async function deleteAssessment',
      '// Duplicate an existing assessment',
    )

    for (const mutation of [lock, unlock, remove]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).toContain('await materializeEvidenceTargetObligations(tx')
      expect(mutation).toContain("sourceModule: 'hazard_assessment'")
    }
    expect(unlock).not.toContain('.delete(attachments)')
    expect(unlock).not.toContain('signatureAttachmentId: null')
    expect(hazardSignatureMigration).toContain('DELETE FROM "attachments" AS attachment')
    expect(hazardSignatureMigration).toContain('hazid_assessments_invalidate_signatures')
  })

  it('keeps hazard signature metadata and private storage deletion in one transaction', () => {
    const add = between(
      hazardActions,
      'export async function addSignature',
      'export async function deleteSignature',
    )
    const remove = between(
      hazardActions,
      'export async function deleteSignature',
      '// ------------------------------------------------------------------\n// Photos',
    )

    for (const mutation of [add, remove]) {
      expect(mutation).toContain('await lockEditableAssessment(ctx, tx, assessmentId)')
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
    }
    expect(remove).toContain('.delete(attachments)')
  })
})
