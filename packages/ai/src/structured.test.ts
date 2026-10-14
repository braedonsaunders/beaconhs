import assert from 'node:assert/strict'
import test from 'node:test'
import { extractJsonObject } from './structured'

test('extractJsonObject reads fenced and raw objects', () => {
  assert.deepEqual(extractJsonObject('```json\n{"summary":"ok"}\n```'), { summary: 'ok' })
  assert.deepEqual(extractJsonObject('Here you go:\n{"summary":"ok"}\n'), { summary: 'ok' })
})
