import assert from 'node:assert/strict'
import test from 'node:test'
import { isAiProvider, secureAiFetch, validateAiBaseUrl } from './client'

test('AI provider validation accepts catalogue entries only, never inherited object keys', () => {
  assert.equal(isAiProvider('anthropic'), true)
  assert.equal(isAiProvider('custom'), true)
  assert.equal(isAiProvider('toString'), false)
  assert.equal(isAiProvider('__proto__'), false)
  assert.equal(isAiProvider('constructor'), false)
})

test('AI base URL validation accepts only canonical public HTTPS overrides', async () => {
  assert.equal(await validateAiBaseUrl('openai', ''), null)
  assert.equal(await validateAiBaseUrl('custom', 'https://8.8.8.8/v1///'), 'https://8.8.8.8/v1')
  await assert.rejects(validateAiBaseUrl('custom', ''), /public HTTPS base URL is required/)
  await assert.rejects(validateAiBaseUrl('custom', 'http://8.8.8.8/v1'), /must use HTTPS/)
  await assert.rejects(validateAiBaseUrl('custom', 'https://127.0.0.1/v1'), /blocked non-public/)
  await assert.rejects(
    validateAiBaseUrl('custom', 'https://8.8.8.8/v1?target=other'),
    /must not include a query string/,
  )
  await assert.rejects(
    validateAiBaseUrl('anthropic', 'https://8.8.8.8/v1'),
    /does not support a custom base URL/,
  )
})

test('AI provider transport rejects unsafe endpoints before opening a socket', async () => {
  await assert.rejects(secureAiFetch('http://8.8.8.8/v1/models'), /must use HTTPS/)
  await assert.rejects(secureAiFetch('https://127.0.0.1/v1/models'), /blocked non-public/)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    secureAiFetch('https://8.8.8.8/v1/models', { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )
})
