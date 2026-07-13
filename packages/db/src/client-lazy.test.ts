import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const sqlClient = Object.assign(vi.fn(), { unsafe: vi.fn() })
  return {
    sqlClient,
    postgres: vi.fn((_url: string, _options?: unknown) => sqlClient),
    drizzle: vi.fn((client: unknown, _options?: unknown) => ({
      $client: client,
      select: vi.fn(() => 'selected'),
    })),
  }
})

vi.mock('postgres', () => ({ default: mocks.postgres }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzle }))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('lazy database clients', () => {
  it('imports without creating runtime or super-admin clients', async () => {
    await import('./client')

    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzle).not.toHaveBeenCalled()
  })

  it('creates each configured database once on first use', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.SUPERADMIN_DATABASE_URL = 'postgresql://super:secret@db.example.test/beaconhs'
    const { db, superDb } = await import('./client')

    expect(db.select()).toBe('selected')
    expect(db.select()).toBe('selected')
    expect(db.$client).toBe(mocks.sqlClient)
    expect(db.$client.unsafe).toBe(mocks.sqlClient.unsafe)
    expect(mocks.postgres).toHaveBeenCalledTimes(1)
    expect(superDb.select()).toBe('selected')
    expect(mocks.postgres).toHaveBeenCalledTimes(2)
    expect(mocks.postgres.mock.calls.map(([url]) => url)).toEqual([
      'postgresql://app:secret@db.example.test/beaconhs',
      'postgresql://super:secret@db.example.test/beaconhs',
    ])
  })

  it('imports safely but fails closed on first unconfigured production use', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    const { db } = await import('./client')

    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(() => db.select).toThrow('[db] DATABASE_URL is required.')
    expect(mocks.postgres).not.toHaveBeenCalled()
  })

  it('validates both production database roles without constructing clients', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    delete process.env.SUPERADMIN_DATABASE_URL
    const { assertDatabaseConfiguration } = await import('./client')

    expect(() => assertDatabaseConfiguration()).not.toThrow()
    expect(() => assertDatabaseConfiguration({ superAdmin: true })).toThrow(
      '[db] SUPERADMIN_DATABASE_URL is required.',
    )
    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzle).not.toHaveBeenCalled()
  })
})
