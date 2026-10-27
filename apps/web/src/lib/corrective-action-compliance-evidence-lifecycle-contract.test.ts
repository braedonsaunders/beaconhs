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
const resolution = source('./corrective-action-resolution.ts')
const detail = source('../app/(app)/corrective-actions/[id]/page.tsx')
const recordEdits = source('../app/(app)/corrective-actions/_record-edits.ts')
const recordSync = source('./record-sync/edits.ts')
// The create form is a drawer on the list page now; its server action lives
// in _actions.ts next to the other CA mutations.
const createAction = between(
  actions,
  'export async function createCorrectiveAction',
  '// ---------- Photos',
)
const api = source('./api/write.ts')
const nativeFlow = source('./flows/spawn.ts')
const formFlow = source('../app/(app)/apps/_lib/spawn-core.ts')
const assistant = source('../app/(app)/assistant/_commit-actions.ts')
const ppe = source('../app/(app)/ppe/_lib.ts')
const inspection = source('../app/(app)/inspections/_lib.ts')

describe('corrective-action compliance evidence lifecycle', () => {
  it('materializes every interactive and automated create path in the insert transaction', () => {
    for (const value of [createAction, nativeFlow, formFlow, assistant, ppe, inspection]) {
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
    // Inline field edits (online or queued offline) land through the record
    // saver: the record row is locked and afterWrites runs in the same batch
    // transaction as the field writes.
    const fieldLoad = between(recordEdits, 'async load(', 'resolve:')
    const field = between(recordEdits, 'async afterWrites(', 'revalidate:')
    const saverRunner = between(recordSync, 'export function defineRecordSaver', '')
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

    expect(close).toContain('ctx.db((tx) =>')
    expect(close).toContain('resolveCorrectiveActionInTx(tx, ctx, args.caId,')
    expect(reopen).toContain('ctx.db((tx) => resumeCorrectiveActionInTx(tx, ctx, caId))')
    const closeInTx = between(
      resolution,
      'export async function resolveCorrectiveActionInTx',
      'export async function resumeCorrectiveActionInTx',
    )
    const reopenInTx = between(resolution, 'export async function resumeCorrectiveActionInTx', '')
    for (const value of [closeInTx, reopenInTx]) expect(value).toContain(".for('update')")
    for (const value of [status, closeInTx, reopenInTx, bulk])
      expectCorrectiveMaterialization(value)
    expect(fieldLoad).toContain(".for('update')")
    expect(field).toContain("change.op === 'dueOn' || change.op === 'ownerTenantUserId'")
    expectCorrectiveMaterialization(field)
    expect(field).toContain('await auditFieldChanges(tx, ctx')
    expect(saverRunner).toContain('outcome = await ctx.db(async (tx)')
    expect(saverRunner).toContain('await spec.afterWrites(tx, ctx, loaded, changes)')
    for (const value of [status, saverRunner, closeInTx, reopenInTx, bulk]) {
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
