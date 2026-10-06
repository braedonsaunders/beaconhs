import { drizzle, type NodePgClient } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  context: null as null | Record<string, unknown>,
  scope: vi.fn(),
}))
vi.mock('../../../lib/auth', () => ({ getRequestContext: async () => mocks.context }))
vi.mock('../../../lib/visibility', () => ({
  moduleScopeWhere: (...args: unknown[]) => mocks.scope(...args),
}))
import { GET } from './route'
const captured: { text: string; values: unknown[] }[] = []
const database = vi.fn()
beforeEach(() => {
  captured.length = 0
  vi.clearAllMocks()
  mocks.scope.mockResolvedValue(undefined)
  const client = {
    query: async (config: { text: string }, values: unknown[]) => {
      captured.push({ text: config.text, values })
      return { rows: [] }
    },
  } as unknown as NodePgClient
  const tx = drizzle(client)
  database.mockImplementation((callback) => callback(tx))
  mocks.context = {
    isSuperAdmin: true,
    permissions: new Set(['*']),
    tenantId: '10000000-0000-4000-8000-000000000001',
    timezone: 'America/Toronto',
    locale: 'en',
    db: database,
  }
})
const request = (query = 'ABCD123') =>
  GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`))
describe('global record search', () => {
  it('requires authentication and does not query for empty or one-letter searches', async () => {
    mocks.context = null
    expect((await request()).status).toBe(401)
    expect(database).not.toHaveBeenCalled()
    mocks.context = { db: database }
    expect((await request('a')).status).toBe(200)
    expect(database).not.toHaveBeenCalled()
  })
  it('uses identical availability and history predicates for previews and totals across every searchable record type', async () => {
    expect((await request()).status).toBe(200)
    expect(database).toHaveBeenCalledOnce()
    expect(captured).toHaveLength(12)
    for (const [table, statuses] of [
      ['people', ['active']],
      ['equipment_items', ['in_service']],
      ['documents', ['draft', 'published', 'under_review']],
      ['incidents', []],
      ['corrective_actions', []],
      ['hazid_assessments', []],
    ] as const) {
      const queries = captured.filter((q) => q.text.includes(`from "${table}"`))
      expect(queries).toHaveLength(2)
      for (const q of queries) {
        expect(q.text).toContain(`"${table}"."deleted_at" is null`)
        for (const status of statuses) expect(q.values).toContain(status)
      }
      const preview = queries.find((q) => q.text.includes('limit $'))!,
        total = queries.find((q) => !q.text.includes('limit $'))!
      expect(preview.values.slice(0, -1)).toEqual(total.values)
      expect(preview.values.at(-1)).toBe(5)
    }
    const equipment = captured.find((q) => q.text.includes('from "equipment_items"'))!
    expect(equipment.text).toContain('"equipment_items"."license_plate" ilike')
    expect(equipment.text).toContain('regexp_replace("equipment_items"."license_plate"')
    expect(equipment.values).not.toContain('retired')
    expect(equipment.values).not.toContain('lost')
    for (const table of ['incidents', 'corrective_actions'])
      for (const query of captured.filter((q) => q.text.includes(`from "${table}"`))) {
        expect(query.text).not.toContain(`"${table}"."status" =`)
        expect(query.text).not.toContain(`"${table}"."status" in`)
      }
    expect(
      captured
        .filter((q) => q.text.includes('from "incidents"'))
        .flatMap((q) => q.values)
        .some((value) => value instanceof Date),
    ).toBe(false)
  })
  it('keeps permission scope outside the field-match OR in both result and count queries', async () => {
    mocks.scope.mockResolvedValue(sql`false`)
    await request()
    for (const table of ['equipment_items', 'incidents', 'corrective_actions', 'hazid_assessments'])
      for (const q of captured.filter((q) => q.text.includes(`from "${table}"`)))
        expect(q.text).toMatch(/and false and/)
    expect(mocks.scope).toHaveBeenCalledTimes(4)
  })
  it('does not expose draft document content to readers without document management permission', async () => {
    mocks.context = {
      ...mocks.context,
      isSuperAdmin: false,
      permissions: new Set(['documents.read']),
    }
    await request()
    const queries = captured.filter((q) => q.text.includes('from "documents"'))
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query.text).toMatch(/"documents"\."status" = \$/)
      expect(query.values.filter((v) => v === 'published')).toHaveLength(2)
    }
  })
})
