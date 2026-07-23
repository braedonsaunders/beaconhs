import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')

describe('reports package boundary', () => {
  it('keeps database adapters behind the server-only subpath', () => {
    expect(root).not.toContain("'./custom-fields'")
    expect(root).not.toContain("'./run'")
    expect(root).not.toContain("'./schedule-run'")
    expect(server).toContain("export * from './custom-fields'")
    expect(server).toContain("export * from './run'")
    expect(server).toContain("export * from './schedule-run'")
  })
})
