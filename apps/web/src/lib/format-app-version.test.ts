import { describe, expect, it } from 'vitest'
import { formatAppVersion } from './format-app-version'

describe('formatAppVersion', () => {
  it('shortens a deploy SHA to the seven characters people actually use', () => {
    expect(formatAppVersion('0d9198255f1c4b2a9e7d3f8a1b2c3d4e5f607182')).toBe('0d91982')
  })

  it('leaves a non-SHA alone', () => {
    // A local run has no deploy stamp at all.
    expect(formatAppVersion('dev')).toBe('dev')
    expect(formatAppVersion('v1.2.3')).toBe('v1.2.3')
  })

  it('ignores surrounding whitespace from the environment', () => {
    expect(formatAppVersion('  dev\n')).toBe('dev')
  })

  it('does not shorten a string that merely looks SHA-ish', () => {
    // Too short, and uppercase hex is not what the deploy writes.
    expect(formatAppVersion('0d91982')).toBe('0d91982')
    expect(formatAppVersion('0D9198255F1C4B2A9E7D3F8A1B2C3D4E5F607182')).toBe(
      '0D9198255F1C4B2A9E7D3F8A1B2C3D4E5F607182',
    )
  })
})
