import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  runtimeDb: vi.fn(),
  superDb: vi.fn(),
  redis: vi.fn(),
}))

vi.mock('@beaconhs/auth', () => ({ getAuth: mocks.getAuth }))
vi.mock('@beaconhs/db', () => ({
  db: { execute: mocks.runtimeDb },
  superDb: { execute: mocks.superDb },
}))
vi.mock('@beaconhs/jobs/health', () => ({ assertRedisReady: mocks.redis }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.getAuth.mockReturnValue({})
  mocks.runtimeDb.mockResolvedValue([])
  mocks.superDb.mockResolvedValue([])
  mocks.redis.mockResolvedValue(undefined)
})

describe('web readiness', () => {
  it('requires auth, runtime DB, super-admin DB, and Redis', async () => {
    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ready' })
    expect(mocks.getAuth).toHaveBeenCalledOnce()
    expect(mocks.runtimeDb).toHaveBeenCalledOnce()
    expect(mocks.superDb).toHaveBeenCalledOnce()
    expect(mocks.redis).toHaveBeenCalledOnce()
  })

  it('fails readiness before accepting traffic when auth is misconfigured', async () => {
    mocks.getAuth.mockImplementation(() => {
      throw new Error('missing secret')
    })
    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'unavailable' })
    expect(mocks.runtimeDb).not.toHaveBeenCalled()
    expect(mocks.superDb).not.toHaveBeenCalled()
    expect(mocks.redis).not.toHaveBeenCalled()
  })
})
