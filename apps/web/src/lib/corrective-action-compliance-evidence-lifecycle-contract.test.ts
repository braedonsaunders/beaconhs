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

function expectCorrectiveMaterialization(value: string): void {
  expect(value).toContain('materializeEvidenceTargetObligations(')
  expect(value).toContain("sourceModule: 'corrective_action'")
}

const actions = source('../app/(app)/corrective-actions/_actions.ts')
const detail = source('../app/(app)/corrective-actions/[id]/page.tsx')
const createPage = source('../app/(app)/corrective-actions/new/page.tsx')
const api = source('./api/write.ts')
const nativeFlow = source('./flows/spawn.ts')
const formFlow = source('../app/(app)/apps/_lib/spawn-core.ts')
const assistant = source('../app/(app)/assistant/_commit-actions.ts')
const ppe = source('../app/(app)/ppe/_lib.ts')
const inspection = source('../app/(app)/inspections/_lib.ts')

describe('corrective-action compliance evidence lifecycle', () => {
  it('materializes every interactive and automated create path in the insert transaction', () => {
    for (const value of [createPage, nativeFlow, formFlow, assistant, ppe, inspection]) {
      expectCorrectiveMaterialization(value)
    }

    const create = between(
      api,
      'async function createCorrectiveAction',
      'function correctiveActionResult',
    )
    expectCorrectiveMaterialization(create)
    expect(create).toContain('await recordAuditInTransaction(tx, ctx')
  })

  it('materializes status, due-date, owner, close, reopen, and bulk-owner changes atomically', () => {
    const status = between(detail, 'async function updateStatus', 'async function reopenAction')
    const field = between(
      detail,
      'async function updateTextField',
      'export async function generateMetadata',
    )
    const close = between(
      actions,
      'export async function closeCorrectiveAction',
      '/**\n * Reopen a closed CA',
    )
    const reopen = between(
      actions,
      'export async function reopenCorrectiveAction',
      '// ---------- Email',
    )
    const bulk = between(actions, 'export async function bulkReassignCorrectiveActions', '')

    for (const value of [status, close, reopen, bulk]) expectCorrectiveMaterialization(value)
    expect(field).toContain("field === 'dueOn' || field === 'ownerTenantUserId'")
    expectCorrectiveMaterialization(field)
    for (const value of [status, field, close, reopen, bulk]) {
      expect(value).toContain('await recordAuditInTransaction(tx, ctx')
    }
  })

  it('materializes API update and archive in their locked write transaction', () => {
    const update = between(
      api,
      'async function updateCorrectiveAction',
      'async function deleteCorrectiveAction',
    )
    const remove = between(
      api,
      'async function deleteCorrectiveAction',
      'const CORRECTIVE_ACTION_BODY',
    )
    for (const value of [update, remove]) {
      expect(value).toContain(".for('update')")
      expect(value).toContain('await recordAuditInTransaction(tx, ctx')
      expectCorrectiveMaterialization(value)
    }
  })
})
