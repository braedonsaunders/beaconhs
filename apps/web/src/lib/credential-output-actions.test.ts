import { describe, expect, it } from 'vitest'
import { DEFAULT_CREDENTIAL_OUTPUTS } from './credential-designs'
import { credentialOutputActions } from './credential-output-actions'

describe('credentialOutputActions', () => {
  it('returns exactly one open action for each distinct output', () => {
    const actions = credentialOutputActions(
      DEFAULT_CREDENTIAL_OUTPUTS,
      '/training/records/record-id/certificate',
    )

    expect(actions).toHaveLength(DEFAULT_CREDENTIAL_OUTPUTS.length)
    expect(actions.map(({ output }) => output.id)).toEqual(
      DEFAULT_CREDENTIAL_OUTPUTS.map(({ id }) => id),
    )
    expect(actions.every(({ label }) => label === 'Open PDF')).toBe(true)
    expect(actions.map(({ href }) => href)).toEqual([
      '/training/records/record-id/certificate?output=certificate',
      '/training/records/record-id/certificate?output=wallet-card',
    ])
  })
})
