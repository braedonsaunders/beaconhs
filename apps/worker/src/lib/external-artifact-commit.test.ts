import { describe, expect, it } from 'vitest'
import { commitExternalArtifact } from './external-artifact-commit'

describe('external artifact commit', () => {
  it('returns the persisted value without rolling back a committed artifact', async () => {
    const calls: string[] = []
    const value = await commitExternalArtifact({
      write: async () => {
        calls.push('write')
      },
      persist: async () => {
        calls.push('persist')
        return 'attachment-id'
      },
      rollback: async () => {
        calls.push('rollback')
      },
    })

    expect(value).toBe('attachment-id')
    expect(calls).toEqual(['write', 'persist'])
  })

  it('removes an uploaded artifact when database persistence fails', async () => {
    const calls: string[] = []
    await expect(
      commitExternalArtifact({
        write: async () => {
          calls.push('write')
        },
        persist: async () => {
          calls.push('persist')
          throw new Error('database failed')
        },
        rollback: async () => {
          calls.push('rollback')
        },
      }),
    ).rejects.toThrow('database failed')
    expect(calls).toEqual(['write', 'persist', 'rollback'])
  })

  it('attempts cleanup even when the object write reports a failure', async () => {
    const calls: string[] = []
    await expect(
      commitExternalArtifact({
        write: async () => {
          calls.push('write')
          throw new Error('write failed')
        },
        persist: async () => {
          calls.push('persist')
        },
        rollback: async () => {
          calls.push('rollback')
        },
      }),
    ).rejects.toThrow('write failed')
    expect(calls).toEqual(['write', 'rollback'])
  })

  it('preserves both failures when compensating cleanup also fails', async () => {
    let caught: unknown
    try {
      await commitExternalArtifact({
        write: async () => undefined,
        persist: async () => {
          throw new Error('database failed')
        },
        rollback: async () => {
          throw new Error('cleanup failed')
        },
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors.map((item: Error) => item.message)).toEqual([
      'database failed',
      'cleanup failed',
    ])
  })
})
