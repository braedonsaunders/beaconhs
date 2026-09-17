import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./migrate.ts', import.meta.url), 'utf8')

describe('schema ownership preflight', () => {
  it('resolves owners from pg_roles so the non-superuser migrator can run it', () => {
    expect(source).not.toMatch(/join pg_authid/)
    expect(source).toContain('join pg_roles r on r.oid = c.relowner')
    expect(source).toContain('join pg_roles r on r.oid = t.typowner')
    expect(source).toContain('join pg_roles r on r.oid = p.proowner')
  })
})
