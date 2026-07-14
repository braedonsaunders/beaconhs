import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actions = readFileSync(
  new URL('../app/(app)/people/_actions/titles.ts', import.meta.url),
  'utf8',
)
const taskPage = readFileSync(
  new URL('../app/(app)/people/titles/[id]/tasks/page.tsx', import.meta.url),
  'utf8',
)
const titlePdf = readFileSync(
  new URL('../app/(app)/people/titles/[id]/pdf/page.tsx', import.meta.url),
  'utf8',
)
const peopleSync = readFileSync(new URL('./people-sync.ts', import.meta.url), 'utf8')
const integrationActions = readFileSync(
  new URL('../app/(app)/admin/integrations/_actions.ts', import.meta.url),
  'utf8',
)
const complianceActions = readFileSync(
  new URL('../app/(app)/compliance/obligations/_actions.ts', import.meta.url),
  'utf8',
)
const complianceTargetLock = readFileSync(
  new URL('../../../../packages/compliance/src/target-lock.ts', import.meta.url),
  'utf8',
)
const orgSync = readFileSync(new URL('./org-sync.ts', import.meta.url), 'utf8')
const peopleBulkActions = readFileSync(
  new URL('../app/(app)/people/_actions/bulk.ts', import.meta.url),
  'utf8',
)
const jobTitleCompliance = readFileSync(
  new URL('./job-title-compliance.ts', import.meta.url),
  'utf8',
)
const newPersonPage = readFileSync(
  new URL('../app/(app)/people/new/page.tsx', import.meta.url),
  'utf8',
)

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('job-title lifecycle and sync ownership contract', () => {
  it('archives titles and tasks without cascading away acknowledgement history', () => {
    expect(actions).not.toMatch(/delete\(personTitles\)/)
    expect(actions).not.toMatch(/delete\(jobTitleTasks\)/)
    expect(actions).toContain("action: 'archive'")
    expect(actions).toContain("eq(complianceObligations.sourceModule, 'job_title_signoff')")
    expect(actions).toContain('isNull(jobTitleTasks.deletedAt)')
  })

  it('does not let acknowledged wording be rewritten', () => {
    expect(actions).toContain(".for('update')")
    expect(actions).toContain('.from(jobTitleTaskAcknowledgments)')
    expect(actions).toContain('This task has acknowledgements and cannot be rewritten.')
  })

  it('keeps acknowledgement evidence atomic, immutable, and free of orphaned signatures', () => {
    const acknowledge = between(
      actions,
      'export async function acknowledgeTitleTask',
      'export async function revokeTitleTaskAck',
    )
    const revoke = between(
      actions,
      'export async function revokeTitleTaskAck',
      '// ---------- cache refresh',
    )

    expect(acknowledge).toContain(".for('update')")
    expect(acknowledge).toContain('if (existing)')
    expect(acknowledge).not.toContain('.onConflictDoUpdate')
    expect(acknowledge).toContain('recordAuditInTransaction')
    expect(revoke).toContain('.delete(attachments)')
    expect(revoke).toContain('recordAuditInTransaction')
  })

  it('serializes and normalizes task reordering with an audit trail', () => {
    const reorder = between(
      actions,
      'export async function reorderTitleTask',
      '// ---------- per-person acknowledgements',
    )

    expect(reorder).toContain(".for('update')")
    expect(reorder).toContain('.set({ entityOrder: index + 1 })')
    expect(reorder).toContain('recordAuditInTransaction')
  })

  it('refreshes the unified compliance scoreboard on title evidence changes', () => {
    expect(jobTitleCompliance).toContain('materializeObligation')
    expect(jobTitleCompliance).toContain('eq(complianceObligations.tenantId, tenantId)')
    expect(jobTitleCompliance).toContain('.orderBy(asc(complianceObligations.id))')
    expect(jobTitleCompliance).toContain(".for('update')")
    expect(actions.match(/lockJobTitleObligations\(/g)?.length ?? 0).toBeGreaterThanOrEqual(9)
    expect(
      actions.match(/materializeLockedJobTitleObligations\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(9)
    expect(newPersonPage).toContain('lockJobTitleObligations')
    expect(newPersonPage).toContain('materializeLockedJobTitleObligations')
    expect(newPersonPage).toContain('recordAuditInTransaction')
  })

  it('locks matching obligations before mutating task and acknowledgement evidence', () => {
    const taskCreate = between(
      actions,
      'export async function addTitleTask',
      'export async function updateTitleTask',
    )
    const taskUpdate = between(
      actions,
      'export async function updateTitleTask',
      'export async function archiveTitleTask',
    )
    const taskArchive = between(
      actions,
      'export async function archiveTitleTask',
      'export async function restoreTitleTask',
    )
    const acknowledge = between(
      actions,
      'export async function acknowledgeTitleTask',
      'export async function revokeTitleTaskAck',
    )
    const revoke = between(
      actions,
      'export async function revokeTitleTaskAck',
      '// ---------- cache refresh',
    )

    expect(taskCreate.indexOf('lockJobTitleObligations')).toBeLessThan(
      taskCreate.indexOf('.insert(jobTitleTasks)'),
    )
    expect(taskUpdate.indexOf('lockJobTitleObligations')).toBeLessThan(
      taskUpdate.indexOf('.update(jobTitleTasks)'),
    )
    expect(taskArchive.indexOf('lockJobTitleObligations')).toBeLessThan(
      taskArchive.indexOf('.update(jobTitleTasks)'),
    )
    expect(acknowledge.indexOf('lockJobTitleObligations')).toBeLessThan(
      acknowledge.indexOf('.insert(jobTitleTaskAcknowledgments)'),
    )
    expect(revoke.indexOf('lockJobTitleObligations')).toBeLessThan(
      revoke.indexOf('.delete(jobTitleTaskAcknowledgments)'),
    )
  })

  it('excludes archived tasks and inactive PDF holders from active surfaces', () => {
    expect(taskPage).toContain('isNull(jobTitleTasks.deletedAt)')
    expect(titlePdf).toContain('isNull(jobTitleTasks.deletedAt)')
    expect(titlePdf).toContain("eq(people.status, 'active')")
    expect(titlePdf).toContain('isNull(people.deletedAt)')
  })

  it('keeps manual-only connections authoritative until deletion hands records back', () => {
    expect(peopleSync).not.toContain('eq(syncConnections.enabled, true)')
    expect(orgSync).not.toContain('eq(syncConnections.enabled, true)')
    expect(peopleBulkActions).not.toContain('eq(syncConnections.enabled, true)')
    expect(peopleSync).toContain('isNull(syncConnections.deletedAt)')
    expect(integrationActions).toContain('isManuallyMaintained: true, sourceConnectionId: null')
    expect(integrationActions).toMatch(/tx\s*\.delete\(syncCrosswalk\)/)
  })

  it('serializes title archive against compliance target creation', () => {
    expect(complianceActions).toContain('lockComplianceTarget(tx, ctx.tenantId, input.kind, ref)')
    expect(complianceTargetLock).toContain("case 'job_title':")
    expect(complianceTargetLock).toContain(".for('key share')")
    expect(complianceTargetLock).toContain('eq(personTitles.tenantId, tenantId)')
    expect(complianceTargetLock).toContain('isNull(personTitles.deletedAt)')
  })
})
