import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretFeedbackTurn, latestFeedbackToolName } from './interpret'

test('interpretFeedbackTurn reads the latest terminal tool output', () => {
  const result = interpretFeedbackTurn([
    {
      type: 'dynamic-tool',
      toolName: 'search_help',
      state: 'output-available',
      output: { items: [] },
    },
    {
      type: 'tool-resolve_as_guidance',
      state: 'output-available',
      output: {
        title: 'Use the help article',
        explanation: 'This is a how-to question.',
        help: [{ id: 'nav', title: 'Navigation', url: '/help/nav' }],
      },
    },
  ])
  assert.equal(result.kind, 'guidance')
  if (result.kind !== 'guidance') return
  assert.equal(result.title, 'Use the help article')
  assert.equal(result.help[0]?.url, '/help/nav')
})

test('interpretFeedbackTurn prefers a later submit_issue over earlier guidance', () => {
  const result = interpretFeedbackTurn([
    {
      type: 'dynamic-tool',
      toolName: 'resolve_as_guidance',
      state: 'output-available',
      output: { title: 'Help', explanation: 'Try this.' },
    },
    {
      type: 'dynamic-tool',
      toolName: 'submit_issue',
      state: 'output-available',
      output: {
        issue: {
          id: '12',
          number: 12,
          url: 'https://example.invalid/issues/12',
          title: 'Save fails',
        },
        stripped: ['email address'],
      },
    },
  ])
  assert.equal(result.kind, 'filed')
  if (result.kind !== 'filed') return
  assert.equal(result.issue.number, 12)
  assert.deepEqual(result.stripped, ['email address'])
})

test('interpretFeedbackTurn returns unavailable when no terminal tool completed', () => {
  const result = interpretFeedbackTurn([
    { type: 'text' },
    {
      type: 'dynamic-tool',
      toolName: 'search_help',
      state: 'output-available',
      output: { items: [] },
    },
  ])
  assert.equal(result.kind, 'unavailable')
})

test('latestFeedbackToolName reads the newest tool', () => {
  assert.equal(
    latestFeedbackToolName([
      { type: 'dynamic-tool', toolName: 'search_help' },
      { type: 'tool-read_help' },
    ]),
    'read_help',
  )
})
