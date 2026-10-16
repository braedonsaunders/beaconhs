import { describe, expect, it, vi } from 'vitest'
import { createDeploymentGuard } from './deployment-guard'

const oldVersion = 'a'.repeat(40)
const newVersion = 'b'.repeat(40)
const action = { method: 'POST', headers: { 'next-action': 'old-action-id' }, body: 'encoded' }

function setup(remoteVersion = oldVersion) {
  const onStale = vi.fn()
  const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes('/api/app-version')) return Response.json({ version: remoteVersion })
    return new Response('action-result')
  })
  const guard = createDeploymentGuard({
    version: oldVersion,
    origin: 'https://beaconhs.example',
    fetch: request,
    onStale,
  })
  return { guard, request, onStale }
}

describe('deployment mutation guard', () => {
  it('blocks an old tab before sending a mutation, without replaying it', async () => {
    const { guard, request, onStale } = setup(newVersion)
    await expect(guard.fetch('/journals', action)).rejects.toThrow('Refresh the app')
    await expect(guard.fetch('/journals', action)).rejects.toThrow('Refresh the app')
    expect(request).toHaveBeenCalledTimes(1)
    expect(onStale).toHaveBeenCalledExactlyOnceWith('version_mismatch')
  })

  it('shares the version probe and passes the original requests through exactly once', async () => {
    const { guard, request, onStale } = setup()
    await Promise.all([guard.fetch('/journals', action), guard.fetch('/training', action)])
    expect(request).toHaveBeenCalledTimes(3)
    expect(
      request.mock.calls.filter(([input]) => String(input).includes('app-version')),
    ).toHaveLength(1)
    expect(request).toHaveBeenCalledWith('/journals', action)
    expect(request).toHaveBeenCalledWith('/training', action)
    expect(onStale).not.toHaveBeenCalled()
  })

  it('does not gate native autosaves, ordinary navigation, or external requests', async () => {
    const { guard, request, onStale } = setup(newVersion)
    await guard.fetch('/api/records/sync', { method: 'POST', body: 'field edits' })
    await guard.fetch('/journals')
    await guard.fetch('https://external.example', action)
    expect(request).toHaveBeenCalledTimes(3)
    expect(onStale).not.toHaveBeenCalled()
  })

  it('marks a missing action for recovery and never retries the action', async () => {
    const { guard, request, onStale } = setup()
    request.mockImplementation(async (input) =>
      String(input).includes('app-version')
        ? Response.json({ version: oldVersion })
        : new Response('', { status: 404, headers: { 'x-nextjs-action-not-found': '1' } }),
    )
    await expect(guard.fetch('/people', action)).rejects.toThrow('Refresh the app')
    expect(onStale).toHaveBeenCalledExactlyOnceWith('action_not_found')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not invent a deployment change from a failed probe', async () => {
    const { guard, request, onStale } = setup()
    request.mockImplementation(async (input) => {
      if (String(input).includes('app-version')) throw new Error('offline')
      return new Response('normal action response')
    })
    expect((await guard.fetch('/journals', action)).status).toBe(200)
    expect(onStale).not.toHaveBeenCalled()
  })

  it('honors Request objects and does not replay a failed mutation', async () => {
    const { guard, request } = setup()
    const mutation = new Request('https://beaconhs.example/journals', action)
    request.mockImplementation(async (input) => {
      if (String(input).includes('app-version')) return Response.json({ version: oldVersion })
      throw new Error('connection closed after sending')
    })
    await expect(guard.fetch(mutation)).rejects.toThrow('connection closed after sending')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(mutation, undefined)
  })

  it('rechecks cached versions after the probe interval', async () => {
    let now = 1
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version: oldVersion }))
    const guard = createDeploymentGuard({
      version: oldVersion,
      origin: 'https://beaconhs.example',
      fetch: request,
      onStale: vi.fn(),
      now: () => now,
    })
    await guard.check()
    now += 1_000
    await guard.check()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValue(Response.json({ version: oldVersion }))
    now += 15_000
    await guard.check()
    expect(request).toHaveBeenCalledTimes(2)
  })
})

describe('deployment refresh save barrier', () => {
  it('waits for record edits and uploads before reloading', async () => {
    const { refreshAfterDeployment } = await import('./deployment-guard')
    let saved!: () => void
    const flush = () =>
      new Promise<void>((resolve) => {
        saved = resolve
      })
    const reload = vi.fn()
    const confirmUnsent = vi.fn()
    const pending = refreshAfterDeployment({ flush, reload, confirmUnsent })
    expect(reload).not.toHaveBeenCalled()
    saved()
    await pending
    expect(reload).toHaveBeenCalledOnce()
    expect(confirmUnsent).not.toHaveBeenCalled()
  })

  it('keeps the page open when unsent work cannot sync and the worker cancels', async () => {
    const { refreshAfterDeployment } = await import('./deployment-guard')
    const reload = vi.fn()
    expect(
      await refreshAfterDeployment({
        flush: async () => {
          throw new Error('upload failed')
        },
        confirmUnsent: async () => false,
        reload,
      }),
    ).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('offers an explicitly warned escape when an old failed action cannot finish', async () => {
    const { refreshAfterDeployment } = await import('./deployment-guard')
    const confirmUnsent = vi.fn().mockResolvedValue(true)
    const reload = vi.fn()
    expect(
      await refreshAfterDeployment({
        flush: async () => {
          throw new Error('action from old build')
        },
        confirmUnsent,
        reload,
      }),
    ).toBe(true)
    expect(confirmUnsent).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })
})
