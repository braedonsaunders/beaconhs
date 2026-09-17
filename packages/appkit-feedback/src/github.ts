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
const USER_AGENT = 'appkit-feedback'

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
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  }
  const defaultLabels = [...(options.labels ?? [])]

  async function githubJson(
    url: string,
    method: 'GET' | 'POST',
    body?: string,
    failure = 'GitHub request failed.',
  ) {
    const response = await options.request({
      url,
      method,
      headers,
      ...(body ? { body } : {}),
    })
    return readJson(response, failure)
  }

  async function postIssue(draft: IssueDraft, extraLabels: readonly string[]) {
    const body = await githubJson(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      'POST',
      JSON.stringify(githubIssueBody(draft, extraLabels)),
      'GitHub could not create the issue.',
    )
    return readPublishedIssue(body, draft.title)
  }

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
      try {
        return await postIssue(draft, defaultLabels)
      } catch (error) {
        if (
          !isUnknownLabelError(error) ||
          (defaultLabels.length === 0 && draft.labels.length === 0)
        )
          throw error
        return await postIssue({ ...draft, labels: [] }, [])
      }
    },
  }
}

export async function verifyGithubIssueAccess(options: GithubIssuePublisherOptions): Promise<void> {
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
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }

  const repoResponse = await options.request({
    url: `https://api.github.com/repos/${owner}/${repo}`,
    method: 'GET',
    headers,
  })
  readJson(repoResponse, 'GitHub could not read that repository.')

  const issuesResponse = await options.request({
    url: `https://api.github.com/repos/${owner}/${repo}/issues?per_page=1`,
    method: 'GET',
    headers,
  })
  if (issuesResponse.status < 200 || issuesResponse.status >= 300) {
    let parsed: unknown
    try {
      parsed = issuesResponse.body ? JSON.parse(issuesResponse.body) : {}
    } catch {
      parsed = {}
    }
    throw new Error(
      formatGithubFailure(issuesResponse.status, parsed, 'GitHub could not list issues.'),
    )
  }

  for (const label of unique(options.labels ?? [])) {
    const encoded = encodeURIComponent(label)
    const labelResponse = await options.request({
      url: `https://api.github.com/repos/${owner}/${repo}/labels/${encoded}`,
      method: 'GET',
      headers,
    })
    if (labelResponse.status === 404) {
      throw new Error(
        `GitHub label "${label}" does not exist on ${owner}/${repo}. Create it first.`,
      )
    }
    if (labelResponse.status < 200 || labelResponse.status >= 300) {
      let parsed: unknown
      try {
        parsed = labelResponse.body ? JSON.parse(labelResponse.body) : {}
      } catch {
        parsed = {}
      }
      throw new Error(
        formatGithubFailure(
          labelResponse.status,
          parsed,
          `GitHub could not read label "${label}".`,
        ),
      )
    }
  }
}

export function githubIssueBody(
  draft: IssueDraft,
  extraLabels: readonly string[] = [],
): {
  title: string
  body: string
  labels?: string[]
} {
  const labels = unique([...extraLabels, ...draft.labels])
  return labels.length > 0
    ? { title: draft.title, body: draft.body, labels }
    : { title: draft.title, body: draft.body }
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
    const snippet = response.body.replace(/\s+/g, ' ').trim().slice(0, 160)
    throw new Error(
      snippet ? `GitHub ${response.status}: ${snippet}` : `GitHub ${response.status}: ${failure}`,
    )
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(formatGithubFailure(response.status, parsed, failure))
  }
  const record = asRecord(parsed)
  if (!record) {
    throw new Error(
      Array.isArray(parsed)
        ? `GitHub ${response.status}: received a list instead of a created issue.`
        : `GitHub ${response.status}: ${failure}`,
    )
  }
  return record
}

function formatGithubFailure(status: number, parsed: unknown, failure: string): string {
  const record = asRecord(parsed)
  const message = typeof record?.message === 'string' ? record.message.trim() : ''
  const details = Array.isArray(record?.errors)
    ? record.errors.flatMap((item) => {
        const row = asRecord(item)
        if (!row) return []
        const field = typeof row.field === 'string' ? row.field : ''
        const code = typeof row.code === 'string' ? row.code : ''
        const value = typeof row.value === 'string' ? row.value : ''
        const rowMessage = typeof row.message === 'string' ? row.message : ''
        const summary = rowMessage || [field, code, value].filter(Boolean).join(' ')
        return summary ? [summary] : []
      })
    : []
  const detail = [message, ...details].filter(Boolean).join(' — ')
  return detail ? `GitHub ${status}: ${detail}` : `GitHub ${status}: ${failure}`
}

function isUnknownLabelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /GitHub 422/.test(error.message) && /label/i.test(error.message)
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
