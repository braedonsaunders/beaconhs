export const REPORT_SCHEDULE_LIMITS = {
  nameChars: 200,
  timezoneChars: 100,
  recipientCount: 1_000,
  recipientEmailChars: 320,
  recipientUserIdChars: 128,
  recipientEmailListChars: 400_000,
  recipientUserIdListChars: 150_000,
  filtersChars: 65_536,
  filtersBytes: 131_072,
  filtersDepth: 12,
  filtersNodes: 2_000,
  filterKeyChars: 128,
} as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function assertRecipientCount(count: number): void {
  if (count > REPORT_SCHEDULE_LIMITS.recipientCount) {
    throw new Error(
      `Scheduled reports may have at most ${REPORT_SCHEDULE_LIMITS.recipientCount} recipients.`,
    )
  }
}

export function normalizeReportRecipientEmails(values: readonly string[]): string[] {
  const normalized = new Set<string>()
  for (const raw of values) {
    const value = raw.trim().toLowerCase()
    if (
      !value ||
      value.length > REPORT_SCHEDULE_LIMITS.recipientEmailChars ||
      !EMAIL_PATTERN.test(value)
    ) {
      throw new Error(`Invalid report recipient email address: ${value || '(blank)'}`)
    }
    normalized.add(value)
    assertRecipientCount(normalized.size)
  }
  return [...normalized]
}

export function normalizeReportRecipientUserIds(values: readonly string[]): string[] {
  const normalized = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (
      !value ||
      value.length > REPORT_SCHEDULE_LIMITS.recipientUserIdChars ||
      /[\s\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error('A report recipient member identifier is invalid.')
    }
    normalized.add(value)
    assertRecipientCount(normalized.size)
  }
  return [...normalized]
}

export function assertReportRecipientLimit(userIds: readonly string[], emails: readonly string[]) {
  assertRecipientCount(userIds.length + emails.length)
}

export function assertBoundedReportFilters(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Report filters must be a JSON object.')
  }

  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('Report filters must be JSON serializable.')
  }
  if (encoded.length > REPORT_SCHEDULE_LIMITS.filtersChars) {
    throw new Error('Report filters are too large.')
  }
  if (new TextEncoder().encode(encoded).byteLength > REPORT_SCHEDULE_LIMITS.filtersBytes) {
    throw new Error('Report filters are too large.')
  }

  let nodes = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > REPORT_SCHEDULE_LIMITS.filtersNodes) {
      throw new Error('Report filters contain too many values.')
    }
    if (current.depth > REPORT_SCHEDULE_LIMITS.filtersDepth) {
      throw new Error('Report filters are nested too deeply.')
    }
    if (!current.value || typeof current.value !== 'object') continue

    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        stack.push({ value: entry, depth: current.depth + 1 })
      }
      continue
    }

    for (const [key, entry] of Object.entries(current.value as Record<string, unknown>)) {
      if (key.length > REPORT_SCHEDULE_LIMITS.filterKeyChars || UNSAFE_OBJECT_KEYS.has(key)) {
        throw new Error('Report filters contain an invalid key.')
      }
      stack.push({ value: entry, depth: current.depth + 1 })
    }
  }
}
