import { describe, expect, it } from 'vitest'
import { parseAssistantTurnRequest } from './turn-request'
import { MAX_ASSISTANT_PROMPT_CHARS } from './limits'

// REGRESSION: every first message in a new assistant chat returned 400.
// /assistant renders with activeId={null}, so the client posted
// {"conversationId":null,...} — JSON.stringify drops undefined but keeps null —
// and the route treated a present-but-null id as malformed. Resuming an
// existing conversation worked, which is why the admin AI test looked healthy.

const CONVERSATION_ID = '2f8156ef-af95-4cfa-89fe-584876e42552'

describe('parseAssistantTurnRequest', () => {
  it('treats a null conversationId as "start a new conversation"', () => {
    const result = parseAssistantTurnRequest({ conversationId: null, prompt: 'hello' })
    expect(result).toEqual({ ok: true, request: { conversationId: null, prompt: 'hello' } })
  })

  it('treats an omitted conversationId the same way', () => {
    const result = parseAssistantTurnRequest({ prompt: 'hello' })
    expect(result).toEqual({ ok: true, request: { conversationId: null, prompt: 'hello' } })
  })

  it('accepts a real conversation id', () => {
    const result = parseAssistantTurnRequest({ conversationId: CONVERSATION_ID, prompt: 'hello' })
    expect(result).toEqual({
      ok: true,
      request: { conversationId: CONVERSATION_ID, prompt: 'hello' },
    })
  })

  it('rejects a conversationId that is neither null nor a string', () => {
    for (const conversationId of [42, {}, [], true]) {
      expect(parseAssistantTurnRequest({ conversationId, prompt: 'hi' })).toEqual({
        ok: false,
        status: 400,
        reason: 'Bad request',
      })
    }
  })

  it('rejects a supplied id that is not a uuid, including the empty string', () => {
    for (const conversationId of ['', 'not-a-uuid', '../../etc/passwd']) {
      expect(parseAssistantTurnRequest({ conversationId, prompt: 'hi' })).toMatchObject({
        ok: false,
        status: 400,
      })
    }
  })

  it('trims the prompt and rejects a blank one', () => {
    expect(parseAssistantTurnRequest({ prompt: '  spaced  ' })).toMatchObject({
      ok: true,
      request: { prompt: 'spaced' },
    })
    expect(parseAssistantTurnRequest({ prompt: '   ' })).toEqual({
      ok: false,
      status: 400,
      reason: 'Empty prompt',
    })
  })

  it('rejects a missing or non-string prompt', () => {
    expect(parseAssistantTurnRequest({})).toEqual({
      ok: false,
      status: 400,
      reason: 'Invalid prompt',
    })
    expect(parseAssistantTurnRequest({ prompt: 12 })).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects an oversized prompt with 413, not 400', () => {
    const prompt = 'x'.repeat(MAX_ASSISTANT_PROMPT_CHARS + 1)
    expect(parseAssistantTurnRequest({ prompt })).toEqual({
      ok: false,
      status: 413,
      reason: 'Prompt too large',
    })
  })

  it('rejects bodies that are not plain objects', () => {
    for (const body of [null, undefined, 'string', 7, [{ prompt: 'hi' }]]) {
      expect(parseAssistantTurnRequest(body)).toEqual({
        ok: false,
        status: 400,
        reason: 'Bad request',
      })
    }
  })
})
