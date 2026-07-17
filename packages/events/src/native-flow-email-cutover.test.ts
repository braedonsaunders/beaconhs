import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

function caseSource(kind: string, nextKind?: string): string {
  const start = source.indexOf(`case '${kind}':`)
  const end = nextKind
    ? source.indexOf(`case '${nextKind}':`, start)
    : source.indexOf('\n  }\n}', start)
  expect(start, `missing ${kind} delivery branch`).toBeGreaterThanOrEqual(0)
  expect(end, `missing end of ${kind} delivery branch`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('native module Flow email cutover', () => {
  it.each([
    ['incident_reported', 'incident_status_changed'],
    ['incident_status_changed', 'corrective_action_assigned'],
    ['corrective_action_assigned', 'corrective_action_completed'],
    ['corrective_action_completed', undefined],
  ])('keeps %s alerts in-app/push-only', (kind, nextKind) => {
    const branch = caseSource(kind, nextKind)

    expect(branch).toContain('enqueueNotification')
    expect(branch).not.toContain('enqueueEmail')
    expect(branch).not.toContain('domain-email')
  })
})
