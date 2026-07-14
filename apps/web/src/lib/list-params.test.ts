import { describe, expect, it } from 'vitest'
import { isUuid, parsePrefixedListParams } from './list-params'

describe('isUuid', () => {
  it('accepts canonical UUIDs regardless of hexadecimal case', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it.each([
    '',
    'not-an-id',
    '550e8400e29b41d4a716446655440000',
    '550e8400-e29b-41d4-a716-44665544000',
    '550e8400-e29b-41d4-a716-446655440000-extra',
    ' 550e8400-e29b-41d4-a716-446655440000',
    'zzzzzzzz-e29b-41d4-a716-446655440000',
  ])('rejects malformed UUID input %j', (value) => {
    expect(isUuid(value)).toBe(false)
  })
})

describe('parsePrefixedListParams', () => {
  it('reads only the named sub-list parameters', () => {
    expect(
      parsePrefixedListParams(
        {
          q: 'outer',
          page: '9',
          reviewQ: 'annual',
          reviewSort: 'oldest',
          reviewDir: 'asc',
          reviewPage: '3',
          reviewPerPage: '20',
        },
        'review',
        {
          sort: 'recent',
          dir: 'desc',
          perPage: 10,
          allowedSorts: ['recent', 'oldest'] as const,
        },
      ),
    ).toEqual({ q: 'annual', sort: 'oldest', dir: 'asc', page: 3, perPage: 20 })
  })

  it('applies the same validation and bounds as a top-level list', () => {
    expect(
      parsePrefixedListParams(
        {
          versionSort: 'invalid',
          versionDir: 'sideways',
          versionPage: '-4',
          versionPerPage: '1000',
        },
        'version',
        { sort: 'recent', perPage: 12, allowedSorts: ['recent', 'oldest'] as const },
      ),
    ).toEqual({ q: undefined, sort: 'recent', dir: 'desc', page: 1, perPage: 100 })
  })
})
