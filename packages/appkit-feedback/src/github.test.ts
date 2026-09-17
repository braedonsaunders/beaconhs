import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubIssuePublisher, githubIssueBody } from './github'

test('githubIssueBody merges default labels without duplicates', () => {
  assert.deepEqual(
    githubIssueBody(
      { title: 'Save fails', body: 'The save button does nothing.', labels: ['bug', 'Feedback'] },
      ['feedback'],
    ),
    {
      title: 'Save fails',
      body: 'The save button does nothing.',
      labels: ['feedback', 'bug'],
    },
  )
})

test('createGithubIssuePublisher posts a sanitized issue through the host request', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  const publisher = createGithubIssuePublisher({
    owner: 'acme',
    repo: 'product',
    token: 'test-token',
    labels: ['feedback'],
    request: async ({ url, method, headers, body }) => {
      calls.push({ url, method, body })
      assert.equal(headers.authorization, 'Bearer test-token')
      if (method === 'GET') {
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: 3,
                number: 3,
                title: 'Known save failure',
                html_url: 'https://github.com/acme/product/issues/3',
              },
            ],
          }),
        }
      }
      return {
        status: 201,
        body: JSON.stringify({
          id: 99,
          number: 41,
          title: 'Save fails',
          html_url: 'https://github.com/acme/product/issues/41',
        }),
      }
    },
  })

  const existing = await publisher.searchOpen?.('Save fails for casey@acme.test')
  assert.equal(existing?.[0]?.id, '3')
  assert.equal(existing?.[0]?.title, 'Known save failure')
  assert.match(calls[0]!.url, /api\.github\.com\/search\/issues/)
  assert.doesNotMatch(calls[0]!.url, /casey@acme\.test/)

  const created = await publisher.create({
    title: 'Save fails',
    body: 'The save button does nothing.',
    labels: ['ui'],
  })
  assert.equal(created.number, 41)
  assert.equal(created.url, 'https://github.com/acme/product/issues/41')
  assert.match(calls[1]!.url, /repos\/acme\/product\/issues/)
  assert.match(calls[1]!.body ?? '', /"labels":\["feedback","ui"\]/)
})

test('createGithubIssuePublisher rejects an invalid repository', () => {
  assert.throws(
    () =>
      createGithubIssuePublisher({
        owner: 'acme/extra',
        repo: 'product',
        token: 'test-token',
        request: async () => ({ status: 200, body: '{}' }),
      }),
    /owner/,
  )
})
