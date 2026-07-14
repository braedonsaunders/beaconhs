import { afterEach, describe, expect, it, vi } from 'vitest'
import { LatestAutosaveQueue } from './autosave-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LatestAutosaveQueue', () => {
  it('debounces each key and keeps only its latest pending task', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const saved: string[] = []

    queue.schedule('rich', 900, async () => {
      saved.push('old')
    })
    queue.schedule('rich', 900, async () => {
      saved.push('latest')
    })

    await vi.advanceTimersByTimeAsync(899)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual(['latest'])
  })

  it('serializes writes and runs a newer edit after the active save', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const gate = deferred()
    const events: string[] = []

    queue.schedule('meta', 10, async () => {
      events.push('first:start')
      await gate.promise
      events.push('first:end')
    })
    await vi.advanceTimersByTimeAsync(10)
    queue.schedule('meta', 10, async () => {
      events.push('latest')
    })
    await vi.advanceTimersByTimeAsync(10)

    expect(events).toEqual(['first:start'])
    gate.resolve()
    await queue.flush()
    expect(events).toEqual(['first:start', 'first:end', 'latest'])
  })

  it('preserves edit order across independently debounced keys', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const saved: string[] = []

    queue.schedule('rich', 20, async () => {
      saved.push('rich')
    })
    queue.schedule('meta', 10, async () => {
      saved.push('meta')
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(10)
    expect(saved).toEqual(['rich', 'meta'])
  })

  it('retains a failed latest task and exposes it to retry', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const snapshots: string[] = []
    const save = vi.fn().mockRejectedValueOnce(new Error('Network unavailable'))
    save.mockResolvedValueOnce(undefined)
    queue.subscribe(({ state }) => snapshots.push(state))

    queue.schedule('meta', 10, save)
    await vi.advanceTimersByTimeAsync(10)
    expect(snapshots.at(-1)).toBe('error')
    expect(queue.hasWork()).toBe(true)

    await queue.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(snapshots.at(-1)).toBe('saved')
    expect(queue.hasWork()).toBe(false)
  })

  it('does not surface an obsolete failure when a newer value is already queued', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const gate = deferred()
    const saved: string[] = []

    queue.schedule('rich', 10, async () => {
      await gate.promise
      throw new Error('stale request failed')
    })
    await vi.advanceTimersByTimeAsync(10)
    queue.schedule('rich', 10, async () => {
      saved.push('latest')
    })
    await vi.advanceTimersByTimeAsync(10)
    gate.resolve()
    await queue.flush()

    expect(saved).toEqual(['latest'])
    expect(queue.hasWork()).toBe(false)
  })

  it('flushes every pending key without waiting for its debounce', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const saved: string[] = []

    queue.schedule('module-order', 600, async () => {
      saved.push('modules')
    })
    queue.schedule('lessons:a', 600, async () => {
      saved.push('lessons:a')
    })
    queue.schedule('lessons:b', 600, async () => {
      saved.push('lessons:b')
    })

    await queue.flush()
    expect(saved).toEqual(['modules', 'lessons:a', 'lessons:b'])
  })

  it('holds pending work and waits for the active write before a terminal action', async () => {
    vi.useFakeTimers()
    const queue = new LatestAutosaveQueue()
    const gate = deferred()
    const events: string[] = []

    queue.schedule('meta', 10, async () => {
      events.push('active:start')
      await gate.promise
      events.push('active:end')
    })
    await vi.advanceTimersByTimeAsync(10)
    queue.schedule('rich', 100, async () => {
      events.push('pending')
    })

    const paused = queue.pauseAndWait().then(() => events.push('terminal'))
    await Promise.resolve()
    expect(events).toEqual(['active:start'])
    gate.resolve()
    await paused
    expect(events).toEqual(['active:start', 'active:end', 'terminal'])

    queue.resume()
    await queue.retry()
    expect(events).toEqual(['active:start', 'active:end', 'terminal', 'pending'])
  })
})
