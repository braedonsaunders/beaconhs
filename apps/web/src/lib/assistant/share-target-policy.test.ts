import { describe, expect, it } from 'vitest'
import {
  MAX_SHARE_TARGET_QUERY_CHARS,
  escapeShareTargetSearch,
  parseShareTargetSearchInput,
} from './share-target-policy'

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID = '10000000-0000-4000-8000-000000000001'

describe('assistant share-target search policy', () => {
  it('normalizes a bounded search and selected-value hydration request', () => {
    expect(
      parseShareTargetSearchInput({
        conversationId: CONVERSATION_ID,
        targetType: 'user',
        query: '  Saunders_100%  ',
        selected: TARGET_ID,
      }),
    ).toEqual({
      conversationId: CONVERSATION_ID,
      targetType: 'user',
      query: 'Saunders_100%',
      selected: TARGET_ID,
    })
    expect(escapeShareTargetSearch('Saunders_100%')).toBe('Saunders\\_100\\%')
  })

  it.each([
    null,
    {},
    {
      conversationId: 'bad-id',
      targetType: 'user',
      query: '',
      selected: null,
    },
    {
      conversationId: CONVERSATION_ID,
      targetType: 'team',
      query: '',
      selected: null,
    },
    {
      conversationId: CONVERSATION_ID,
      targetType: 'role',
      query: 'x'.repeat(MAX_SHARE_TARGET_QUERY_CHARS + 1),
      selected: null,
    },
    {
      conversationId: CONVERSATION_ID,
      targetType: 'role',
      query: '',
      selected: 'bad-id',
    },
  ])('rejects malformed search input %#', (input) => {
    expect(() => parseShareTargetSearchInput(input)).toThrow('Invalid share target search.')
  })
})
