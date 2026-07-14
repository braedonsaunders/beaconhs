import { describe, expect, it } from 'vitest'
import {
  MAX_JOURNAL_AI_CONTEXT_LENGTH,
  MAX_JOURNAL_AI_SOURCE_LENGTH,
  MAX_JOURNAL_AI_TONE_LENGTH,
  parseJournalAiTextInput,
} from './journal-ai-policy'

describe('journal AI request policy', () => {
  it('accepts bounded text without changing it', () => {
    expect(
      parseJournalAiTextInput({ text: '  field notes  ', tone: 'clear', context: 'day shift' }),
    ).toEqual({
      ok: true,
      value: { text: '  field notes  ', tone: 'clear', context: 'day shift' },
    })
  })

  it('rejects blank, malformed, and silently lossy requests', () => {
    expect(parseJournalAiTextInput({ text: '   ' })).toEqual({
      ok: false,
      error: 'Nothing to work with',
    })
    expect(parseJournalAiTextInput({ text: 'notes', tone: 4 })).toEqual({
      ok: false,
      error: 'Invalid tone',
    })
    expect(parseJournalAiTextInput({ text: 'x'.repeat(MAX_JOURNAL_AI_SOURCE_LENGTH + 1) })).toEqual(
      {
        ok: false,
        error: 'Select 8,000 characters or fewer for AI assist',
      },
    )
    expect(
      parseJournalAiTextInput({
        text: 'notes',
        tone: 'x'.repeat(MAX_JOURNAL_AI_TONE_LENGTH + 1),
      }),
    ).toMatchObject({ ok: false })
    expect(
      parseJournalAiTextInput({
        text: 'notes',
        context: 'x'.repeat(MAX_JOURNAL_AI_CONTEXT_LENGTH + 1),
      }),
    ).toMatchObject({ ok: false })
  })
})
