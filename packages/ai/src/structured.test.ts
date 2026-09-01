import assert from 'node:assert/strict'
import test from 'node:test'
import { coerceJournalAnalysis, extractJsonObject } from './structured'
import { journalAnalysisSchema } from './analysis'

test('extractJsonObject reads fenced and raw objects', () => {
  assert.deepEqual(extractJsonObject('```json\n{"summary":"ok"}\n```'), { summary: 'ok' })
  assert.deepEqual(extractJsonObject('Here you go:\n{"summary":"ok"}\n'), { summary: 'ok' })
})

test('coerceJournalAnalysis maps the OpenRouter/Kimi field names onto the stored schema', () => {
  const coerced = coerceJournalAnalysis({
    note: 'Only two journal entries were provided.',
    overall_sentiment: {
      assessment: 'Mixed but operationally engaged.',
      drivers: ['Wash up was going well.', 'Permit gaps introduce exposure.'],
    },
    recurring_themes: ['Permitting and documentation', 'Fall protection'],
    concrete_issues: [
      {
        issue: 'Worker positioned outside the scissor-lift platform.',
        evidence: 'Zachary reported Ryan working outside the lift.',
        risk: 'Fall from height.',
      },
    ],
    recommended_actions: [
      {
        action: 'Toolbox talk with Ryan L on scissor-lift rules.',
        owner: 'Elliott',
        addresses: 'Issue 1 — working outside scissor lift.',
      },
    ],
  })
  const parsed = journalAnalysisSchema.safeParse(coerced)
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.summary, 'Only two journal entries were provided.')
  assert.equal(parsed.data.sentiment.label, 'mixed')
  assert.equal(parsed.data.themes.length, 2)
  assert.equal(parsed.data.issues[0]?.title, 'Worker positioned outside the scissor-lift platform.')
  assert.equal(parsed.data.actions[0]?.owner, 'Elliott')
})
