import { readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const submitLifecycle = source('./form-response-lifecycle.ts')
const fillActions = source('../../app/(app)/apps/templates/[id]/fill/actions.ts')
const lifecycleActions = source('../../app/(app)/apps/responses/[id]/_lifecycle-actions.ts')
const workflowActions = source('../../app/(app)/apps/responses/[id]/_actions.ts')
const monitorActions = source('../../app/(app)/apps/responses/[id]/_monitor-actions.ts')
const formFlow = source('../../app/(app)/apps/_lib/form-flow-adapter.ts')
const hazardOwner = source('../../app/(app)/hazard-assessments/_actions.ts')
const api = source('../api/builder-apps.ts')
const pdfWorker = source('../../../../worker/src/workers/pdf.ts')
const scheduledWorker = source('../../../../worker/src/workers/scheduled.ts')

function runtimeResponseWriters(
  rootUrl: URL,
  operation: 'insert' | 'update' | 'delete' = 'update',
): string[] {
  const root = fileURLToPath(rootUrl)
  const found: string[] = []
  const responseWriteToken = ['.', operation, '(formResponses)'].join('')
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        visit(path)
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.includes('.test.') &&
        !entry.name.includes('.spec.') &&
        readFileSync(path, 'utf8').includes(responseWriteToken)
      ) {
        found.push(relative(root, path).replaceAll('\\', '/'))
      }
    }
  }
  visit(root)
  return found.sort()
}

describe('generic form-response parent-lock contract', () => {
  it('keeps an exhaustive inventory of every web and worker response writer', () => {
    expect(runtimeResponseWriters(new URL('../../', import.meta.url))).toEqual([
      'app/(app)/apps/_lib/form-flow-adapter.ts',
      'app/(app)/apps/responses/[id]/_actions.ts',
      'app/(app)/apps/responses/[id]/_lifecycle-actions.ts',
      'app/(app)/apps/responses/[id]/_monitor-actions.ts',
      'app/(app)/apps/templates/[id]/fill/actions.ts',
      'app/(app)/hazard-assessments/_actions.ts',
      'lib/api/builder-apps.ts',
      'lib/forms/form-response-lifecycle.ts',
    ])
    expect(runtimeResponseWriters(new URL('../../../../worker/src/', import.meta.url))).toEqual([
      'workers/pdf.ts',
      'workers/scheduled.ts',
    ])

    expect(runtimeResponseWriters(new URL('../../', import.meta.url), 'insert')).toEqual([
      'app/(app)/apps/_lib/form-flow-adapter.ts',
      'app/(app)/apps/templates/[id]/fill/actions.ts',
      'app/(app)/hazard-assessments/_actions.ts',
      'lib/forms/form-response-lifecycle.ts',
    ])
    expect(
      runtimeResponseWriters(new URL('../../../../worker/src/', import.meta.url), 'insert'),
    ).toEqual([])
    expect(runtimeResponseWriters(new URL('../../', import.meta.url), 'delete')).toEqual([])
    expect(
      runtimeResponseWriters(new URL('../../../../worker/src/', import.meta.url), 'delete'),
    ).toEqual([])
  })

  it('keeps every non-submission response create evidence-ineligible', () => {
    expect(formFlow.match(/\.insert\(formResponses\)/gu)).toHaveLength(2)
    expect(formFlow.match(/status: 'draft'/gu)).toHaveLength(2)
    expect(fillActions.match(/\.insert\(formResponses\)/gu)).toHaveLength(1)
    expect(fillActions).toContain("status: 'draft'")
    expect(hazardOwner.match(/\.insert\(formResponses\)/gu)).toHaveLength(1)
    expect(hazardOwner).toContain("status: 'draft'")

    expect(submitLifecycle.match(/\.insert\(formResponses\)/gu)).toHaveLength(1)
    expect(submitLifecycle).toContain('status: finalStatus')
    expect(submitLifecycle).toContain('await materializeFormResponseEvidenceChange(')
  })

  it('guards every runtime form-response update writer outside the owning HazID action', () => {
    const guardedWriters = [
      [submitLifecycle, 1, 1],
      [fillActions, 2, 2],
      [lifecycleActions, 4, 4],
      [workflowActions, 4, 3],
      [monitorActions, 2, 2],
      [formFlow, 3, 3],
      [pdfWorker, 1, 1],
      [scheduledWorker, 1, 1],
    ] as const

    for (const [writer, updateCount, guardCount] of guardedWriters) {
      expect(writer.match(/\.update\(formResponses\)/gu)).toHaveLength(updateCount)
      expect(writer.match(/await lockFormResponseForMutation\(/gu)).toHaveLength(guardCount)
    }

    expect(api.match(/\.update\(formResponses\)/gu)).toHaveLength(2)
    expect(api.match(/await lockApiResponseForMutation\(/gu)).toHaveLength(2)
    expect(api).toContain('return await lockFormResponseForMutation(tx, ctx.tenantId, responseId)')
  })

  it('guards response-owned workflow and monitoring child rows before mutation', () => {
    const sign = between(
      workflowActions,
      'export async function signWorkflowStep',
      '// 2. advanceWorkflowStep',
    )
    const advance = between(
      workflowActions,
      'export async function advanceWorkflowStep',
      '// 3. rejectWorkflowStep',
    )
    const reject = workflowActions.slice(
      workflowActions.indexOf('export async function rejectWorkflowStep'),
    )
    for (const action of [sign, advance, reject]) {
      expect(action.indexOf('await lockFormResponseForMutation(')).toBeLessThan(
        action.indexOf('await upsertStepRowAfterResponseLock('),
      )
      expect(action.indexOf('await lockFormResponseForMutation(')).toBeLessThan(
        action.indexOf('.update(formResponses)'),
      )
      expect(action.indexOf('.update(formResponses)')).toBeLessThan(
        action.indexOf('await rebuildWorkflowStateAfterResponseLock('),
      )
    }
    expect(advance.match(/transition = await ctx\.db\(/gu)).toHaveLength(1)
    expect(reject.match(/mutation = await ctx\.db\(/gu)).toHaveLength(1)
    expect(workflowActions.match(/\.delete\(attachments\)/gu)).toHaveLength(2)

    const checkin = between(
      monitorActions,
      'export async function recordSessionCheckin',
      'async function closeSession',
    )
    expect(checkin.indexOf('await lockFormResponseForMutation')).toBeLessThan(
      checkin.indexOf('.insert(formResponseCheckins)'),
    )
    expect(scheduledWorker.indexOf('await lockFormResponseForMutation')).toBeLessThan(
      scheduledWorker.indexOf('.insert(formResponseCheckins)'),
    )
  })

  it('never takes a response row lock before the shared parent-first guard', () => {
    expect(fillActions).not.toContain(".for('update', { of: formResponses })")
    expect(pdfWorker).not.toMatch(/\.from\(formResponses\)[\s\S]{0,300}\.for\('update'\)/u)
    expect(scheduledWorker).not.toContain(".for('update', { skipLocked: true })")
  })

  it('keyset-pages overdue sessions so skipped locked parents cannot starve later rows', () => {
    expect(scheduledWorker).toContain(
      'let cursor: { nextCheckinDueAt: Date; id: string } | null = null',
    )
    expect(scheduledWorker).toContain('gt(formResponses.nextCheckinDueAt, cursor.nextCheckinDueAt)')
    expect(scheduledWorker).toContain('gt(formResponses.id, cursor.id)')
    expect(scheduledWorker).toContain('cursor = page.nextCursor')
  })

  it('replaces durable response PDFs without overwriting the committed object first', () => {
    const durablePdf = between(
      pdfWorker,
      'async function storeFormResponsePdfArtifact',
      'async function storeTransientPdfArtifact',
    )
    expect(durablePdf).toContain('const r2Key = newAttachmentKey(')
    expect(durablePdf).not.toContain('observed.attachment?.r2Key')
    expect(durablePdf.indexOf('await lockFormResponseForMutation(')).toBeLessThan(
      durablePdf.indexOf('.insert(attachments)'),
    )
    expect(durablePdf).toContain('const attachmentId = await commitExternalArtifact({')
    expect(durablePdf).toContain('.delete(attachments)')
    expect(durablePdf).toContain('rollback: () => deleteObject({ key: r2Key })')
  })

  it('materializes every form-evidence lifecycle transition in its write transaction', () => {
    expect(submitLifecycle).toContain('await materializeFormResponseEvidenceChange(')
    expect(lifecycleActions.match(/await materializeFormResponseEvidenceChange\(/gu)).toHaveLength(
      2,
    )
    expect(workflowActions.match(/await materializeFormResponseEvidenceChange\(/gu)).toHaveLength(2)
    expect(formFlow.match(/await materializeFormResponseEvidenceChange\(/gu)).toHaveLength(1)
    expect(api.match(/await materializeFormResponseEvidenceChange\(/gu)).toHaveLength(2)
  })

  it('does not rematerialize compliance for draft payload or monitor-only writes', () => {
    expect(fillActions).not.toContain('materializeFormResponseEvidenceChange')
    expect(monitorActions).not.toContain('materializeFormResponseEvidenceChange')
    expect(pdfWorker).not.toContain('materializeFormResponseEvidenceChange')
    expect(scheduledWorker).not.toContain('materializeFormResponseEvidenceChange')
  })
})
