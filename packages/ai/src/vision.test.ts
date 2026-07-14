import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AI_VISION_LIMITS, assertVisionRequest } from './vision'

describe('AI vision request bounds', () => {
  it('accepts bounded storage bytes', () => {
    assert.doesNotThrow(() =>
      assertVisionRequest({ images: [new Uint8Array([1]), new Uint8Array([2, 3])] }),
    )
  })

  it('rejects empty, excessive-count, and individually oversized images', () => {
    assert.throws(() => assertVisionRequest({ images: [] }), /between 1 and 4/)
    assert.throws(
      () =>
        assertVisionRequest({
          images: Array.from({ length: AI_VISION_LIMITS.images + 1 }, () => new Uint8Array([1])),
        }),
      /between 1 and 4/,
    )
    assert.throws(
      () => assertVisionRequest({ images: [new Uint8Array(AI_VISION_LIMITS.imageBytes + 1)] }),
      /image exceeds/,
    )
  })

  it('rejects aggregate base64-expansion risk and oversized prompts', () => {
    assert.throws(
      () =>
        assertVisionRequest({
          images: [new Uint8Array(6 * 1024 * 1024), new Uint8Array(4 * 1024 * 1024 + 1)],
        }),
      /total bytes/,
    )
    assert.throws(
      () =>
        assertVisionRequest({
          images: [new Uint8Array([1])],
          prompt: 'x'.repeat(AI_VISION_LIMITS.promptChars + 1),
        }),
      /prompt exceeds/,
    )
  })
})
