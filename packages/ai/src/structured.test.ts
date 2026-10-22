import assert from 'node:assert/strict'
import test from 'node:test'
import { extractJsonObject } from './structured'

test('extractJsonObject reads fenced and raw objects', () => {
  assert.deepEqual(extractJsonObject('```json\n{"summary":"ok"}\n```'), { summary: 'ok' })
  assert.deepEqual(extractJsonObject('Here you go:\n{"summary":"ok"}\n'), { summary: 'ok' })
})

test('extractJsonObject handles long fenced whitespace and unmatched fences', () => {
  assert.deepEqual(extractJsonObject('```JSON' + ' '.repeat(200_000) + '{"ok":true}\n```'), {
    ok: true,
  })
  assert.deepEqual(extractJsonObject('```json\n{"ok":true}'), { ok: true })
  assert.throws(() => extractJsonObject('```' + ' '.repeat(200_000)))
})
