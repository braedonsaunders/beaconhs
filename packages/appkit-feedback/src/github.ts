import { redactPii } from './redact'
import type { FeedbackHttpRequest, IssueDraft, IssuePublisher, PublishedIssue } from './types'

export type GithubIssuePublisherOptions = {
  owner: string
  repo: string
  token: string
  labels?: readonly string[]
  request: FeedbackHttpRequest
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

export function createGithubIssuePublisher(options: GithubIssuePublisherOptions): IssuePublisher {
  const owner = options.owner.trim()
  const repo = options.repo.trim()
  const token = options.token.trim()
  if (!OWNER_RE.test(owner)) throw new Error('A valid repository owner is required.')
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..')
    throw new Error('A valid repository name is required.')
  if (!token) throw new Error('An access token is required.')

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  }
  const defaultLabels = [...(options.labels ?? [])]

  return {
    async searchOpen(query) {
      const cleaned = redactPii(query).text.replace(/"/g, '').trim()
      if (!cleaned) return []
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:issue is:open ${cleaned}`)}&per_page=5`
      const response = await options.request({ url, method: 'GET', headers })
      if (response.status === 403 || response.status === 422) return []
      const body = readJson(response, 'GitHub issue search failed.')
      const items = Array.isArray(body.items) ? body.items : []
      return items.flatMap((item) => {
        const record = asRecord(item)
        if (!record) return []
        const number = Number(record.number)
        const htmlUrl = typeof record.html_url === 'string' ? record.html_url : ''
        const title = typeof record.title === 'string' ? record.title : ''
        if (!Number.isInteger(number) || !htmlUrl || !title) return []
        return [{ id: String(record.id ?? number), title, url: htmlUrl }]
      })
    },
    async create(draft) {
      const url = `https://api.github.com/repos/${owner}/${repo}/issues`
      const response = await options.request({
        url,
        method: 'POST',
        headers,
        body: JSON.stringify(githubIssueBody(draft, defaultLabels)),
      })
      const body = readJson(response, 'GitHub could not create the issue.')
      return readPublishedIssue(body, draft.title)
    },
  }
}

export function githubIssueBody(
  draft: IssueDraft,
  extraLabels: readonly string[] = [],
): {
  title: string
  body: string
  labels: string[]
} {
  const labels = unique([...extraLabels, ...draft.labels])
  return { title: draft.title, body: draft.body, labels }
}

function readPublishedIssue(value: Record<string, unknown>, fallbackTitle: string): PublishedIssue {
  const number = Number(value.number)
  const url = typeof value.html_url === 'string' ? value.html_url : ''
  const id = value.id != null ? String(value.id) : String(number)
  const title = typeof value.title === 'string' && value.title.trim() ? value.title : fallbackTitle
  if (!Number.isInteger(number) || !url) throw new Error('GitHub returned an incomplete issue.')
  return { id, number, url, title }
}

function readJson(
  response: { status: number; body: string },
  failure: string,
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = response.body ? JSON.parse(response.body) : {}
  } catch {
    throw new Error(failure)
  }
  if (response.status < 200 || response.status >= 300) {
    const record = asRecord(parsed)
    const message =
      typeof record?.message === 'string' && record.message.trim() ? record.message : failure
    throw new Error(message)
  }
  const record = asRecord(parsed)
  if (!record) throw new Error(failure)
  return record
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const label = value.trim()
    if (!label || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    next.push(label)
  }
  return next
}
