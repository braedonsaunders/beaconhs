import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actions = readFileSync(
  new URL('../app/(app)/hazard-assessments/_actions.ts', import.meta.url),
  'utf8',
)

function between(start: string, end: string): string {
  const startIndex = actions.indexOf(start)
  const endIndex = actions.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return actions.slice(startIndex, endIndex)
}

const editableMutations = [
  between('export async function updateTextField', 'export async function lockAssessment'),
  between('export async function addTask', 'export async function updateTask'),
  between('export async function updateTask', 'export async function deleteTask'),
  between('export async function deleteTask', 'export async function moveTask'),
  between('export async function addHazard', 'export async function addHazardSet'),
  between('export async function addHazardSet', 'export async function updateHazard'),
  between('export async function updateHazard', 'export async function deleteHazard'),
  between('export async function deleteHazard', 'export async function moveHazard'),
  between('export async function addPPE', 'export async function updatePPE'),
  between('export async function updatePPE', 'export async function answerPPE'),
  between('export async function answerPPE', 'export async function deletePPE'),
  between('export async function deletePPE', 'export async function movePPE'),
  between('export async function addQuestion', 'export async function answerQuestion'),
  between('export async function answerQuestion', 'export async function updateQuestion'),
  between('export async function updateQuestion', 'export async function deleteQuestion'),
  between('export async function deleteQuestion', 'export async function moveQuestion'),
  between('export async function deleteSignature', '// Photos'),
  between('export async function attachPhotos', 'export async function deletePhoto'),
  between('export async function deletePhoto', '// Library CRUD'),
]

describe('hazard-assessment transactional locking contract', () => {
  it('locks the tenant-owned, visible parent row before testing editability', () => {
    const lockVisible = between(
      'async function lockVisibleAssessment',
      'async function lockEditableAssessment',
    )
    const lockEditable = between(
      'async function lockEditableAssessment',
      'async function setLinkedAssessmentAppsLocked',
    )

    expect(lockVisible).toContain('eq(hazidAssessments.tenantId, ctx.tenantId)')
    expect(lockVisible).toContain('isNull(hazidAssessments.deletedAt)')
    expect(lockVisible).toContain(".for('update')")
    expect(lockVisible).toContain('await canSeeRecord(ctx, tx')
    expect(lockEditable).toContain('await lockVisibleAssessment(ctx, tx, assessmentId)')
    expect(lockEditable).toContain('if (row.locked)')
  })

  it('revalidates every direct child mutation after acquiring the parent lock', () => {
    for (const mutation of editableMutations) {
      expect(mutation).toContain('await ctx.db(async (tx) =>')
      expect(mutation).toMatch(/await lockEditableAssessment\(ctx, tx, (?:assessmentId|id)\)/u)
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).not.toContain('await recordAudit(ctx')
    }
  })

  it('locks and audits signature storage in its attachment transaction', () => {
    const addSignature = between(
      'export async function addSignature',
      'export async function deleteSignature',
    )

    expect(addSignature).toContain('await withStoredSignatureAttachment(')
    expect(addSignature).toContain('await lockEditableAssessment(ctx, tx, assessmentId)')
    expect(addSignature).toContain('await recordAuditInTransaction(tx, ctx')
    expect(addSignature).not.toContain('await recordAudit(ctx')
  })

  it('locks the parent in the same transaction for every reorder', () => {
    for (const name of ['moveTask', 'moveHazard', 'movePPE', 'moveQuestion']) {
      expect(actions).toContain(`export async function ${name}`)
    }
    const reorder = actions.slice(actions.indexOf('async function reorderEntities'))
    expect(reorder).toContain('await ctx.db(async (tx) =>')
    expect(reorder).toContain('await lockEditableAssessment(ctx, tx, assessmentId)')
    expect(reorder).toContain('await recordAuditInTransaction(tx, ctx')
  })

  it('propagates assessment locking to already-open embedded app responses', () => {
    const appLock = between(
      'async function setLinkedAssessmentAppsLocked',
      'async function latestTemplateVersion',
    )
    const lock = between(
      'export async function lockAssessment',
      'export async function unlockAssessment',
    )
    const unlock = between(
      'export async function unlockAssessment',
      'export async function deleteAssessment',
    )

    expect(appLock).toContain('.orderBy(asc(formResponses.id))')
    expect(appLock).toContain(".for('update', { of: formResponses })")
    expect(appLock).toContain('eq(formResponses.tenantId, args.tenantId)')
    expect(appLock).toContain('isNull(formResponses.deletedAt)')
    expect(lock).toContain('await setLinkedAssessmentAppsLocked(tx, {')
    expect(lock).toContain('locked: true')
    expect(unlock).toContain('await setLinkedAssessmentAppsLocked(tx, {')
    expect(unlock).toContain('locked: false')
  })

  it('serializes embedded-app creation and assessment copying with signing', () => {
    const create = between(
      'async function createAssessment(',
      'export async function startAssessment',
    )
    const openApp = between(
      'export async function openAssessmentApp',
      'export async function updateTextField',
    )
    const copy = between(
      'export async function copyAssessment',
      '// ------------------------------------------------------------------\n// Tasks\n',
    )

    expect(create).toContain('if (copyFromId) await lockVisibleAssessment(ctx, tx, copyFromId)')
    expect(openApp).toContain(
      'const lockedAssessment = await lockVisibleAssessment(ctx, tx, assessmentId)',
    )
    expect(openApp.indexOf('await lockVisibleAssessment')).toBeLessThan(
      openApp.indexOf('await createAssessmentAppResponse'),
    )
    expect(copy).toContain('await lockVisibleAssessment(ctx, tx, sourceId)')
    for (const mutation of [create, openApp, copy]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).not.toContain('await recordAudit(ctx')
    }
  })

  it('uses a typed IN predicate for hazard-set arrays', () => {
    const create = between(
      'async function createAssessment(',
      'export async function startAssessment',
    )
    const addSet = between(
      'export async function addHazardSet',
      'export async function updateHazard',
    )

    for (const mutation of [create, addSet]) {
      expect(mutation).toContain('inArray(hazidHazards.id, set.hazardIds)')
      expect(mutation).not.toContain('ANY(${set.hazardIds})')
    }
  })
})
