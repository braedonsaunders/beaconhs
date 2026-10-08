import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { loadAssistantActivity } from './activity'

function fixture(permissions = ['admin.audit.read']) {
  const queries: { sql: string; params: unknown[] }[] = []
  const tx = drizzle(async (query, params) => {
    queries.push({ sql: query, params })
    return { rows: [] }
  })
  const db = vi.fn(async (load: (db: Database) => Promise<unknown>) =>
    load(tx as unknown as Database),
  )
  const ctx = {
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    timezone: 'America/Toronto',
    permissions: new Set(permissions),
    isSuperAdmin: false,
    db,
  } as unknown as RequestContext
  return { ctx, queries, db }
}

describe('assistant activity access and query boundaries', () => {
  it('requires audit access before loading usage', async () => {
    const { ctx, db } = fixture(['assistant.use'])
    await expect(loadAssistantActivity(ctx, {})).rejects.toThrow()
    expect(db).not.toHaveBeenCalled()
  })
  it('loads only tenant assistant metadata with bounded pagination', async () => {
    const { ctx, queries } = fixture()
    const result = await loadAssistantActivity(ctx, { page: '3', perPage: '10', outcome: 'failed' })
    expect(result.params).toMatchObject({ page: 3, perPage: 10 })
    expect(queries).toHaveLength(3)
    expect(queries[0]!.params).toContain(10)
    expect(queries[0]!.params).toContain(20)
    for (const query of queries) {
      expect(query.params).toContain(ctx.tenantId)
      expect(query.params).toContain('assistant')
      expect(query.sql).not.toMatch(/"content"|"title"|"email"/)
    }
    expect(queries[0]!.sql).toContain('"failed" > 0')
    expect(queries[1]!.sql).toContain('"failed" > 0')
  })
  it('uses the account timezone for inclusive date limits and literal name searches', async () => {
    const { ctx, queries } = fixture()
    await loadAssistantActivity(ctx, {
      q: '50%_crew',
      from: '2026-10-01',
      to: '2026-10-07',
      user: 'person-user',
    })
    expect(queries[0]!.params).toContain('%50\\%\\_crew%')
    expect(queries[0]!.params).toContain('person-user')
    expect(queries[0]!.params.map((p) => (p instanceof Date ? p.toISOString() : p))).toContain(
      '2026-10-01T04:00:00.000Z',
    )
    expect(queries[0]!.params.map((p) => (p instanceof Date ? p.toISOString() : p))).toContain(
      '2026-10-08T03:59:59.999Z',
    )
  })
})
