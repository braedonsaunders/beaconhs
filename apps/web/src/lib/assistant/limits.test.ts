import { describe, expect, it } from 'vitest'
import { MAX_ASSISTANT_PROMPT_CHARS, MAX_ASSISTANT_REQUEST_BYTES } from './limits'

describe('assistant request limits', () => {
  it('keeps enough request headroom for the bounded prompt envelope', () => {
    expect(MAX_ASSISTANT_PROMPT_CHARS).toBe(32_000)
    expect(MAX_ASSISTANT_REQUEST_BYTES).toBeGreaterThan(MAX_ASSISTANT_PROMPT_CHARS * 3)
  })
})
