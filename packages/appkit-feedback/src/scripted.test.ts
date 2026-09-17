import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryIssuePublisher } from './memory'
import { createScriptedFeedbackClient } from './scripted'

const context = {
  pathname: '/settings/users/550e8400-e29b-41d4-a716-446655440000',
  pageTitle: 'Users',
}

test('scripted client asks a short report to clarify', async () => {
  const client = createScriptedFeedbackClient({ publisher: createMemoryIssuePublisher() })
  const result = await client.send({ text: 'Broken', context })
  assert.equal(result.kind, 'questions')
})

test('scripted client answers from help before filing', async () => {
  const client = createScriptedFeedbackClient({
    publisher: createMemoryIssuePublisher(),
    knowledge: {
      search: async () => [
        {
          id: 'nav',
          title: 'Change the menu layout',
          url: '/help/nav',
          excerpt: 'Open account, then Menu layout.',
        },
      ],
      read: async () => ({
        title: 'Change the menu layout',
        url: '/help/nav',
        body: 'Open account, then Menu layout.',
      }),
    },
  })
  const result = await client.send({
    text: 'How do I change the menu from the top bar to the sidebar?',
    context,
  })
  assert.equal(result.kind, 'guidance')
  if (result.kind !== 'guidance') return
  assert.equal(result.help[0]?.id, 'nav')
})

test('scripted client files a redacted issue when it is a defect', async () => {
  const publisher = createMemoryIssuePublisher()
  const client = createScriptedFeedbackClient({ publisher, defaultLabels: ['feedback'] })
  const result = await client.send({
    text: 'The save button on the user page does nothing after I click it twice.',
    context,
    forceFile: true,
  })
  assert.equal(result.kind, 'filed')
  if (result.kind !== 'filed') return
  assert.equal(result.issue.number, 1)
  assert.match(publisher.records[0]!.body, /Route: \/settings\/users\/\[id\]/)
  assert.ok(publisher.records[0]!.labels.includes('feedback'))
})
