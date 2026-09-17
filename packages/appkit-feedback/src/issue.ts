import { mergeStripped, redactPii, sanitizeFeedbackContext } from './redact'
import type {
  FeedbackContext,
  FeedbackRedactOptions,
  IssueDraft,
  IssueSeverity,
  PreparedIssueDraft,
} from './types'

const SEVERITIES: readonly IssueSeverity[] = ['low', 'medium', 'high']

export function normalizeIssueSeverity(value: unknown): IssueSeverity | undefined {
  return typeof value === 'string' && SEVERITIES.includes(value as IssueSeverity)
    ? (value as IssueSeverity)
    : undefined
}

export function formatIssueBody(input: {
  whatHappened: string
  expected?: string
  notes?: string
  surface?: string
  pathname: string
  appVersion?: string
}): string {
  const lines = [
    '## What happened',
    input.whatHappened.trim() || 'A product defect was reported from the in-app reporter.',
    '',
  ]
  if (input.expected?.trim()) {
    lines.push('## Expected', input.expected.trim(), '')
  }
  lines.push(
    '## Where',
    `- Surface: ${input.surface?.trim() || 'Unspecified'}`,
    `- Route: ${input.pathname}`,
  )
  if (input.appVersion?.trim()) lines.push(`- App version: ${input.appVersion.trim()}`)
  lines.push('')
  if (input.notes?.trim()) {
    lines.push('## Notes', input.notes.trim(), '')
  }
  lines.push('---', 'Filed from the in-app reporter. Personal and tenant data removed.')
  return lines.join('\n')
}

export function prepareIssueDraft(
  input: {
    title: string
    whatHappened: string
    expected?: string
    notes?: string
    surface?: string
    labels?: string[]
    severity?: IssueSeverity
    context: FeedbackContext
  },
  options: FeedbackRedactOptions = {},
): PreparedIssueDraft {
  const sanitized = sanitizeFeedbackContext(input.context, options)
  const title = redactPii(input.title, options)
  const happened = redactPii(input.whatHappened, options)
  const expected = input.expected ? redactPii(input.expected, options) : null
  const notes = input.notes ? redactPii(input.notes, options) : null
  const surface = input.surface ? redactPii(input.surface, options) : null
  const draft: IssueDraft = {
    title: clampTitle(title.text),
    body: formatIssueBody({
      whatHappened: happened.text,
      expected: expected?.text,
      notes: notes?.text,
      surface: surface?.text,
      pathname: sanitized.context.pathname,
      appVersion: sanitized.context.appVersion,
    }),
    labels: uniqueLabels(input.labels ?? []),
    severity: input.severity,
  }
  return {
    draft,
    context: sanitized.context,
    stripped: mergeStripped(
      sanitized.stripped,
      title.stripped,
      happened.stripped,
      expected?.stripped ?? [],
      notes?.stripped ?? [],
      surface?.stripped ?? [],
    ),
  }
}

function clampTitle(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim() || 'Product issue reported from the application'
  return cleaned.length > 80 ? `${cleaned.slice(0, 77).trimEnd()}…` : cleaned
}

function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const label of labels) {
    const value = label.trim()
    if (!value || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    next.push(value)
  }
  return next
}
