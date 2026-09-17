import type { FeedbackContext, FeedbackRedactOptions, SanitizedFeedbackContext } from './types'

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE = /(?<!\w)(?:\+?\d[\d().\s-]{7,}\d)(?!\w)/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_ID = /(?<![A-Za-z0-9])\d{6,}(?![A-Za-z0-9])/g
const NATIONAL_ID = /\b(?:\d{3}-\d{2}-\d{4}|\d{3}[\s-]\d{3}[\s-]\d{3})\b/g

export type RedactResult = {
  text: string
  stripped: string[]
}

function addStripped(stripped: string[], label: string) {
  if (!stripped.includes(label)) stripped.push(label)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactPii(input: string, options: FeedbackRedactOptions = {}): RedactResult {
  const stripped: string[] = []
  let text = input

  const deny = (options.denyList ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length)
  for (const value of deny) {
    const next = text.replace(new RegExp(escapeRegExp(value), 'gi'), '[redacted]')
    if (next !== text) addStripped(stripped, 'identifying name')
    text = next
  }

  text = text.replace(EMAIL, () => {
    addStripped(stripped, 'email address')
    return '[email]'
  })
  text = text.replace(NATIONAL_ID, () => {
    addStripped(stripped, 'identification number')
    return '[id]'
  })
  text = text.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '')
    if (digits.length < 10) return match
    addStripped(stripped, 'phone number')
    return '[phone]'
  })
  text = text.replace(UUID, () => {
    addStripped(stripped, 'record id')
    return '[id]'
  })
  text = text.replace(LONG_ID, () => {
    addStripped(stripped, 'record id')
    return '[id]'
  })

  return { text, stripped }
}

export function sanitizePathname(pathname: string): { pathname: string; stripped: string[] } {
  const stripped: string[] = []
  const [path, query] = pathname.split('?', 2)
  if (query) addStripped(stripped, 'query string')
  const segments = (path || '/').split('/').map((segment) => {
    if (!segment) return segment
    if (UUID.test(segment) || LONG_ID.test(segment)) {
      addStripped(stripped, 'record id')
      UUID.lastIndex = 0
      LONG_ID.lastIndex = 0
      return '[id]'
    }
    UUID.lastIndex = 0
    LONG_ID.lastIndex = 0
    return segment
  })
  const sanitized = segments.join('/') || '/'
  return { pathname: sanitized.startsWith('/') ? sanitized : `/${sanitized}`, stripped }
}

export function sanitizeFeedbackContext(
  context: FeedbackContext,
  options: FeedbackRedactOptions = {},
): { context: SanitizedFeedbackContext; stripped: string[] } {
  const path = sanitizePathname(context.pathname)
  const title = context.pageTitle ? redactPii(context.pageTitle, options) : null
  const stripped = [...path.stripped]
  if (title) for (const item of title.stripped) addStripped(stripped, item)
  return {
    context: {
      pathname: path.pathname,
      pageTitle: title?.text || undefined,
      appVersion: context.appVersion?.trim() || undefined,
      locale: context.locale?.trim() || undefined,
    },
    stripped,
  }
}

export function mergeStripped(...lists: readonly (readonly string[])[]): string[] {
  const merged: string[] = []
  for (const list of lists) {
    for (const item of list) addStripped(merged, item)
  }
  return merged
}
