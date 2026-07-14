import { describe, expect, it } from 'vitest'
import { parseRemoteSearchInput, remoteSearchTerm } from './remote-search-policy'

const ID = '10000000-0000-4000-8000-000000000001'

describe('action-backed remote search policy', () => {
  it('normalizes bounded UUID-backed searches', () => {
    expect(
      parseRemoteSearchInput({ query: '  north yard  ', selected: ID.toUpperCase() }, 'uuid'),
    ).toEqual({ query: 'north yard', selected: ID })
  })

  it('supports bounded text values without treating them as identifiers', () => {
    expect(
      parseRemoteSearchInput({ query: ' safe ', selected: ' concrete pour ' }, 'text'),
    ).toEqual({ query: 'safe', selected: 'concrete pour' })
  })

  it('escapes SQL wildcard characters in search patterns', () => {
    expect(remoteSearchTerm('100%_yard\\west')).toBe('%100\\%\\_yard\\\\west%')
  })

  it('rejects malformed, oversized, and augmented requests', () => {
    expect(() => parseRemoteSearchInput(null, 'uuid')).toThrow(/request is invalid/i)
    expect(() =>
      parseRemoteSearchInput({ query: 'x'.repeat(101), selected: null }, 'uuid'),
    ).toThrow(/100 characters or less/)
    expect(() => parseRemoteSearchInput({ query: 'north\u0000', selected: null }, 'uuid')).toThrow(
      /Search text is invalid/,
    )
    expect(() => parseRemoteSearchInput({ query: '', selected: 'not-a-uuid' }, 'uuid')).toThrow(
      /Selected option is invalid/,
    )
    expect(() =>
      parseRemoteSearchInput({ query: '', selected: null, tenantId: ID }, 'uuid'),
    ).toThrow(/request is invalid/i)
  })
})
