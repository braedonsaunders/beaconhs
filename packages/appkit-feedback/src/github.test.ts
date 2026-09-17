import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubIssuePublisher, githubIssueBody, verifyGithubIssueAccess } from './github'

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
      assert.equal(headers['user-agent'], 'appkit-feedback')
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

test('createGithubIssuePublisher retries without labels when GitHub rejects them', async () => {
  const bodies: string[] = []
  const publisher = createGithubIssuePublisher({
    owner: 'acme',
    repo: 'product',
    token: 'test-token',
    labels: ['missing-label'],
    request: async ({ body }) => {
      bodies.push(body ?? '')
      if (bodies.length === 1) {
        return {
          status: 422,
          body: JSON.stringify({
            message: 'Validation Failed',
            errors: [
              { resource: 'Label', field: 'labels', code: 'invalid', value: 'missing-label' },
            ],
          }),
        }
      }
      return {
        status: 201,
        body: JSON.stringify({
          id: 7,
          number: 7,
          title: 'Save fails',
          html_url: 'https://github.com/acme/product/issues/7',
        }),
      }
    },
  })

  const created = await publisher.create({
    title: 'Save fails',
    body: 'The save button does nothing.',
    labels: [],
  })
  assert.equal(created.number, 7)
  assert.match(bodies[0] ?? '', /missing-label/)
  assert.doesNotMatch(bodies[1] ?? '', /"labels"/)
})

test('createGithubIssuePublisher names a list response as a failed create', async () => {
  const publisher = createGithubIssuePublisher({
    owner: 'acme',
    repo: 'product',
    token: 'test-token',
    request: async () => ({
      status: 200,
      body: JSON.stringify([{ number: 1, html_url: 'https://github.com/acme/product/issues/1' }]),
    }),
  })
  await assert.rejects(
    publisher.create({ title: 'Save fails', body: 'Broken.', labels: [] }),
    /list/,
  )
})

test('createGithubIssuePublisher surfaces a non-JSON GitHub rejection', async () => {
  const publisher = createGithubIssuePublisher({
    owner: 'acme',
    repo: 'product',
    token: 'test-token',
    request: async () => ({
      status: 403,
      body: 'Request forbidden by administrative rules. Please make sure your request has a User-Agent header.',
    }),
  })
  await assert.rejects(
    publisher.create({ title: 'Save fails', body: 'Broken.', labels: [] }),
    /User-Agent/,
  )
})

test('verifyGithubIssueAccess checks the repository, issues, and labels', async () => {
  const urls: string[] = []
  await verifyGithubIssueAccess({
    owner: 'acme',
    repo: 'product',
    token: 'test-token',
    labels: ['feedback'],
    request: async ({ url, headers }) => {
      urls.push(url)
      assert.equal(headers['user-agent'], 'appkit-feedback')
      if (url.endsWith('/labels/feedback')) {
        return { status: 200, body: JSON.stringify({ name: 'feedback' }) }
      }
      if (url.includes('/issues')) {
        return { status: 200, body: JSON.stringify([]) }
      }
      return { status: 200, body: JSON.stringify({ full_name: 'acme/product' }) }
    },
  })
  assert.equal(urls.length, 3)
  await assert.rejects(
    verifyGithubIssueAccess({
      owner: 'acme',
      repo: 'product',
      token: 'test-token',
      labels: ['missing'],
      request: async ({ url }) => {
        if (url.endsWith('/labels/missing')) return { status: 404, body: '{"message":"Not Found"}' }
        if (url.includes('/issues')) return { status: 200, body: '[]' }
        return { status: 200, body: JSON.stringify({ full_name: 'acme/product' }) }
      },
    }),
    /label "missing"/,
  )
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
