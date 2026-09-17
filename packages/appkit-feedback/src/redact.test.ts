import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareIssueDraft } from './issue'
import { redactPii, sanitizeFeedbackContext, sanitizePathname } from './redact'

test('redactPii strips emails, phones, ids, and a host deny list', () => {
  const result = redactPii(
    'Call Jane Doe at +1 (416) 555-0199 or jane.doe@example.com about record 550e8400-e29b-41d4-a716-446655440000 and ticket 1234567',
    { denyList: ['Jane Doe', 'Acme Construction'] },
  )
  assert.match(result.text, /\[email\]/)
  assert.match(result.text, /\[phone\]/)
  assert.match(result.text, /\[id\]/)
  assert.match(result.text, /\[redacted\]/)
  assert.ok(result.stripped.includes('email address'))
  assert.ok(result.stripped.includes('phone number'))
  assert.ok(result.stripped.includes('record id'))
  assert.ok(result.stripped.includes('identifying name'))
  assert.doesNotMatch(result.text, /Jane Doe/)
  assert.doesNotMatch(result.text, /example\.com/)
})

test('sanitizePathname replaces record ids and drops query strings', () => {
  const result = sanitizePathname('/incidents/550e8400-e29b-41d4-a716-446655440000?q=secret')
  assert.equal(result.pathname, '/incidents/[id]')
  assert.ok(result.stripped.includes('record id'))
  assert.ok(result.stripped.includes('query string'))
})

test('prepareIssueDraft never publishes a raw tenant name or email', () => {
  const prepared = prepareIssueDraft(
    {
      title: 'Save failed for Acme Construction',
      whatHappened: 'Casey at casey@acme.test could not save INC-100001',
      expected: 'The save button should work',
      surface: 'incidents',
      labels: ['bug'],
      context: {
        pathname: '/incidents/9c858901-8a57-4791-81fe-4c455b099bc9',
        pageTitle: 'INC-100001 · Acme Construction',
        appVersion: 'abc123',
      },
    },
    { denyList: ['Acme Construction'] },
  )
  assert.equal(prepared.context.pathname, '/incidents/[id]')
  assert.doesNotMatch(prepared.draft.title, /Acme Construction/)
  assert.doesNotMatch(prepared.draft.body, /casey@acme\.test/i)
  assert.match(prepared.draft.body, /App version: abc123/)
  assert.match(prepared.draft.body, /Route: \/incidents\/\[id\]/)
  assert.ok(prepared.stripped.includes('email address'))
})

test('sanitizeFeedbackContext keeps a clean page title when nothing sensitive is present', () => {
  const result = sanitizeFeedbackContext({ pathname: '/reports', pageTitle: 'Reports' })
  assert.equal(result.context.pathname, '/reports')
  assert.equal(result.context.pageTitle, 'Reports')
  assert.deepEqual(result.stripped, [])
})
