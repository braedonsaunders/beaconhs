import { secureFetch } from '@beaconhs/sync/egress'
import type { FeedbackHttpRequest } from '@braedonsaunders/appkit-feedback'

/** Host egress used by the in-app reporter and settings verification. */
export const feedbackGithubRequest: FeedbackHttpRequest = async (input) => {
  const response = await secureFetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    timeoutMs: 20_000,
    maxResponseBytes: 512 * 1024,
  })
  const body = await response.text()
  if (response.status < 200 || response.status >= 300) {
    console.error(
      '[feedback/github]',
      input.method,
      input.url,
      response.status,
      body.replace(/\s+/g, ' ').trim().slice(0, 300),
    )
  }
  return { status: response.status, body }
}
