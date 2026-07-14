import { describe, expect, it } from 'vitest'
import { enqueueSerialTask } from './criterion-save-queue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('criterion save queue', () => {
  it('does not start a newer save until the previous save finishes', async () => {
    const gate = deferred()
    const events: string[] = []
    const first = enqueueSerialTask(Promise.resolve(), async () => {
      events.push('first:start')
      await gate.promise
      events.push('first:end')
    })
    const second = enqueueSerialTask(first, async () => {
      events.push('second:start')
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first:start'])

    gate.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('continues with the latest save after an earlier save rejects', async () => {
    const failed = enqueueSerialTask(Promise.resolve(), async () => {
      throw new Error('offline')
    })
    const recovered = enqueueSerialTask(failed, async () => undefined)

    await expect(failed).rejects.toThrow('offline')
    await expect(recovered).resolves.toBeUndefined()
  })
})
