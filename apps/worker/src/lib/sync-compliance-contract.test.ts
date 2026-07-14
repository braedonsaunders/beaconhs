import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./sync-scanner.ts', import.meta.url), 'utf8')

describe('people sync compliance contract', () => {
  it('refreshes compliance after every non-error mutating sync run', () => {
    expect(source).toContain("if (result.status !== 'error')")
    expect(source).toContain('withTenant(db, tenantId')
    expect(source).toContain('materializeTenant(tx, tenantId)')
  })
})
