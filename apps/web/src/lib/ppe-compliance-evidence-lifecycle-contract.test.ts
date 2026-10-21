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
const ppeDetail = source('../app/(app)/ppe/[id]/page.tsx')
const ppeEdits = source('../app/(app)/ppe/_record-edits.ts')
const ppeInspectionActions = source('../app/(app)/ppe/_inspection-actions.ts')
const ppeBulk = source('../app/(app)/ppe/_actions.ts')
const ppeLifecycle = source('../app/(app)/ppe/_lib.ts')
const api = source('./api/write.ts')

describe('PPE compliance evidence lifecycle', () => {
  it('centralizes deterministic PPE type-target fan-out', () => {
    expect(typeEvidence).toContain('materializeEvidenceTargetsObligations(')
    expect(typeEvidence).toContain("sourceModule: 'ppe_inspection' as const")
    expect(typeEvidence).toContain('targetRef: { ppeTypeId }')
  })

  it('refreshes PPE field, inspection, status, and certificate evidence in locked transactions', () => {
    // Inline field edits are applied by the PPE record saver (row locked in
    // `load`, audit + evidence in `afterWrites`, same transaction).
    const update = ppeEdits
    const inspection = between(
      ppeInspectionActions,
      'async function recordPpeInspection',
      'export async function submitPpeInspection',
    )
    const certificate = between(ppeDetail, 'async function addCertificate', '')

    for (const mutation of [update, inspection, certificate]) {
      expect(mutation).toContain(".for('update')")
      expect(mutation).toContain('await materializePpeTypeEvidence(tx, ctx.tenantId')
    }
    expect(update).toContain('await auditFieldChanges(tx, ctx')
    for (const mutation of [inspection, certificate]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
    }

    // Status changes no longer hand-roll the transaction: every one of them
    // delegates to the shared lifecycle helper, which is where the row lock,
    // the evidence refresh, and the audit record now live. That is what keeps
    // a status change from ever landing without attribution.
    const status = between(ppeDetail, 'async function setStatus', 'async function reportIssue')
    expect(status).toContain('await recordPpeIssueAction(ctx, {')
    expect(status).not.toContain('.update(ppeItems)')
    expect(update).toContain("change.op === 'expiresOn' || change.op === 'typeId'")
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
    const apiPpe = between(api, 'async function createPpe', 'const PPE_BODY')

    expect(custody).toContain(".for('update')")
    expect(custody).toContain('Discarded or expired PPE cannot be issued.')
    expect(custody).toContain("sourceModule: 'ppe_inspection'")
    expect(custody).toContain('await recordAuditInTransaction(tx, ctx')
    // Out-of-service gear must not be issuable, and every transition stamps
    // who changed it — both are the point of routing through this helper.
    expect(custody).toContain("item.status === 'out_of_service'")
    expect(custody).toContain('statusChangedByTenantUserId: issuedByTenantUserId')
    for (const mutation of [create, discard, apiPpe]) {
      expect(mutation).toMatch(/materializePpeTypeEvidence\(/u)
    }
    expect(create).toContain('.insert(ppeIssues)')
    expect(create).toContain('await recordAuditInTransaction(tx, ctx')
  })
})
