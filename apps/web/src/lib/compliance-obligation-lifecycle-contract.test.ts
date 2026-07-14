import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actions = readFileSync(
  new URL('../app/(app)/compliance/obligations/_actions.ts', import.meta.url),
  'utf8',
)
const detailActions = readFileSync(
  new URL('../app/(app)/compliance/obligations/[id]/_detail-actions.tsx', import.meta.url),
  'utf8',
)

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('compliance obligation lifecycle contract', () => {
  const setEnabledTransaction = between(
    actions,
    'async function setEnabledInTransaction',
    'export async function createObligation',
  )
  const create = between(
    actions,
    'export async function createObligation',
    'export async function updateObligation',
  )
  const update = between(
    actions,
    'export async function updateObligation',
    'export async function setObligationEnabled',
  )
  const setEnabled = between(
    actions,
    'export async function setObligationEnabled',
    'export async function deleteObligation',
  )
  const remove = actions.slice(actions.indexOf('export async function deleteObligation'))

  it('never treats materialization or audit evidence as best-effort follow-up work', () => {
    expect(actions).not.toContain('async function rematerialize')
    expect(actions).not.toContain('best-effort')
    expect(actions).not.toContain('recordAudit(ctx')
    expect(actions.match(/recordAuditInTransaction\(tx, ctx/g)).toHaveLength(4)
  })

  it('atomically materializes and audits creates and updates', () => {
    for (const mutation of [create, update]) {
      expect(mutation).toContain('await ctx.db(async (tx) =>')
      expect(mutation).toContain('await materializeObligation(tx, ctx.tenantId')
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation.indexOf('await materializeObligation')).toBeLessThan(
        mutation.indexOf('await recordAuditInTransaction'),
      )
    }
    expect(actions).toContain(".for('update')")
    expect(actions).toContain('eq(complianceObligations.tenantId, tenantId)')
    expect(update).toContain('await lockObligation(tx, ctx.tenantId, id)')
    expect(update).toContain('await purgeMaterializedStatus(tx, ctx.tenantId, id)')
    expect(update).toContain('obligationSemanticConfigChanged')
    expect(update).toContain('Compliance obligation targeting or schedule changed')
    expect(update).toContain('await skipQueuedComplianceDispatches(')
  })

  it('atomically rebuilds enabled rows and purges paused or deleted rows', () => {
    expect(setEnabledTransaction).toContain(
      'await materializeObligation(tx, ctx.tenantId, updated)',
    )
    expect(setEnabledTransaction).toContain('await purgeMaterializedStatus(tx, ctx.tenantId, id)')
    expect(setEnabledTransaction).toContain('await skipQueuedComplianceDispatches(')
    expect(setEnabledTransaction).toContain('await recordAuditInTransaction(tx, ctx')

    expect(actions).toContain('.delete(complianceStatus)')
    expect(remove).toContain('await purgeMaterializedStatus(tx, ctx.tenantId, id)')
    expect(remove).toContain('await skipQueuedComplianceDispatches(')
    expect(remove).toContain('await recordAuditInTransaction(tx, ctx')
    expect(actions).toContain('eq(complianceStatus.tenantId, tenantId)')
  })

  it('validates and locks every JSON target and polymorphic audience before use', () => {
    expect(create).toContain('await lockComplianceTarget(tx, ctx.tenantId, input.kind, ref)')
    expect(create).toContain('await lockComplianceAudienceTargets(tx, ctx.tenantId, audienceRows)')
    expect(update).toContain('await lockComplianceTarget(tx, ctx.tenantId, input.kind, ref)')
    expect(update).toContain('await lockComplianceAudienceTargets(tx, ctx.tenantId, audienceRows)')
    expect(setEnabled).toContain(
      'await lockComplianceTarget(tx, ctx.tenantId, snapshot.sourceModule, snapshot.targetRef)',
    )
    expect(setEnabled).toContain('await lockComplianceAudienceTargets(tx, ctx.tenantId, audience)')
  })

  it('surfaces enable and delete failures instead of silently refreshing', () => {
    expect(detailActions).toContain('if (!result.ok)')
    expect(detailActions.match(/toast\.error\(/gu)).toHaveLength(4)
    expect(detailActions).toContain('toast.error(result.error)')
  })
})
