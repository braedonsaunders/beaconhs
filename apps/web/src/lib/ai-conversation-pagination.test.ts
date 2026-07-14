import { describe, expect, it } from 'vitest'
import {
  AI_CONVERSATION_SEARCH_MAX_CHARS,
  AI_CONVERSATION_TITLE_MAX_CHARS,
  decodeAiTimeCursor,
  encodeAiTimeCursor,
  escapeAiConversationSearch,
  normalizeAiConversationSearch,
  normalizeAiConversationTitle,
  validateAiConversationScope,
  validateAiConversationScopeRef,
} from './ai-conversation-pagination'

const ID = '550e8400-e29b-41d4-a716-446655440000'

describe('AI conversation pagination policy', () => {
  it('round-trips a stable timestamp and id cursor', () => {
    const at = new Date('2026-07-13T14:12:03.456Z')
    expect(decodeAiTimeCursor(encodeAiTimeCursor(at, ID))).toEqual({ at, id: ID })
  })

  it.each([
    'not-a-cursor',
    `not-a-date|${ID}`,
    `2026-07-13T14:12:03Z|${ID}`,
    '2026-07-13T14:12:03.456Z|not-an-id',
    `2026-07-13T14:12:03.456Z|${ID}|extra`,
  ])('rejects malformed or non-canonical cursor %j', (cursor) => {
    expect(() => decodeAiTimeCursor(cursor)).toThrow('Invalid pagination cursor.')
  })

  it('validates the feature namespace and optional entity reference', () => {
    expect(validateAiConversationScope('builder.app')).toBe('builder.app')
    expect(validateAiConversationScopeRef(ID)).toBe(ID)
    expect(validateAiConversationScopeRef(null)).toBeNull()
    expect(() => validateAiConversationScope('../assistant')).toThrow()
    expect(() => validateAiConversationScopeRef('')).toThrow()
  })

  it('bounds and escapes literal title searches', () => {
    expect(normalizeAiConversationSearch('  fall_100%  ')).toBe('fall_100%')
    expect(escapeAiConversationSearch('fall_100%\\')).toBe('fall\\_100\\%\\\\')
    expect(() =>
      normalizeAiConversationSearch('x'.repeat(AI_CONVERSATION_SEARCH_MAX_CHARS + 1)),
    ).toThrow('Invalid conversation search.')
  })

  it('normalizes valid titles and rejects empty or oversized caller input', () => {
    expect(normalizeAiConversationTitle('  Daily inspections  ')).toBe('Daily inspections')
    expect(normalizeAiConversationTitle(undefined, 'New chat')).toBe('New chat')
    expect(() => normalizeAiConversationTitle('   ')).toThrow('between 1 and')
    expect(() =>
      normalizeAiConversationTitle('x'.repeat(AI_CONVERSATION_TITLE_MAX_CHARS + 1)),
    ).toThrow('between 1 and')
  })
})
