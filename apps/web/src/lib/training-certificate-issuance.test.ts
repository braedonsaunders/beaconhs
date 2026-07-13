import { describe, expect, it, vi } from 'vitest'
import { issueCertificateConflictSafe } from './training-certificate-issuance'

describe('issueCertificateConflictSafe', () => {
  it('returns the row created by this request', async () => {
    const row = { id: 'created' }
    const findExisting = vi.fn()

    await expect(
      issueCertificateConflictSafe({
        createVerifyToken: () => 'record_token',
        insert: async () => row,
        findExisting,
      }),
    ).resolves.toBe(row)
    expect(findExisting).not.toHaveBeenCalled()
  })

  it('returns the winning row when concurrent issuance conflicts on the subject', async () => {
    const winner = { id: 'winner' }

    await expect(
      issueCertificateConflictSafe({
        createVerifyToken: () => 'record_token',
        insert: async () => null,
        findExisting: async () => winner,
      }),
    ).resolves.toBe(winner)
  })

  it('retries with a fresh token when the token, not the subject, conflicts', async () => {
    const tokens = ['record_collision', 'record_fresh']
    const seen: string[] = []

    await expect(
      issueCertificateConflictSafe({
        createVerifyToken: () => tokens.shift() ?? 'record_exhausted',
        insert: async (token) => {
          seen.push(token)
          return token === 'record_fresh' ? { id: 'created' } : null
        },
        findExisting: async () => null,
      }),
    ).resolves.toEqual({ id: 'created' })
    expect(seen).toEqual(['record_collision', 'record_fresh'])
  })

  it('fails explicitly after repeated token conflicts', async () => {
    await expect(
      issueCertificateConflictSafe({
        createVerifyToken: () => 'record_collision',
        insert: async () => null,
        findExisting: async () => null,
      }),
    ).rejects.toThrow('repeated token conflicts')
  })
})
