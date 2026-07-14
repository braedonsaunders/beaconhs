import { isUuid } from './list-params'

export const AI_CONVERSATION_PAGE_SIZE = 20
export const AI_MESSAGE_PAGE_SIZE = 40
export const AI_CONVERSATION_SEARCH_MAX_CHARS = 120
export const AI_CONVERSATION_TITLE_MAX_CHARS = 120

const MAX_SCOPE_CHARS = 80
const MAX_SCOPE_REF_CHARS = 200

type AiTimeCursor = {
  at: Date
  id: string
}

export function validateAiConversationScope(scope: unknown): string {
  if (
    typeof scope !== 'string' ||
    scope.length === 0 ||
    scope.length > MAX_SCOPE_CHARS ||
    !/^[a-z][a-z0-9._:-]*$/.test(scope)
  ) {
    throw new Error('Invalid conversation scope.')
  }
  return scope
}

export function validateAiConversationScopeRef(scopeRefId: unknown): string | null | undefined {
  if (scopeRefId === null || scopeRefId === undefined) return scopeRefId
  if (
    typeof scopeRefId !== 'string' ||
    scopeRefId.length === 0 ||
    scopeRefId.length > MAX_SCOPE_REF_CHARS
  ) {
    throw new Error('Invalid conversation scope reference.')
  }
  return scopeRefId
}

export function normalizeAiConversationTitle(title: unknown, fallback?: string): string {
  const candidate = title === undefined ? fallback : title
  if (typeof candidate !== 'string') throw new Error('Invalid conversation title.')
  const normalized = candidate.trim()
  if (!normalized || normalized.length > AI_CONVERSATION_TITLE_MAX_CHARS) {
    throw new Error(
      `Conversation titles must be between 1 and ${AI_CONVERSATION_TITLE_MAX_CHARS} characters.`,
    )
  }
  return normalized
}

export function normalizeAiConversationSearch(query: unknown): string {
  if (query === null || query === undefined) return ''
  if (typeof query !== 'string' || query.length > AI_CONVERSATION_SEARCH_MAX_CHARS) {
    throw new Error('Invalid conversation search.')
  }
  return query.trim()
}

export function escapeAiConversationSearch(query: string): string {
  return query.replace(/[\\%_]/g, '\\$&')
}

export function encodeAiTimeCursor(at: Date, id: string): string {
  if (!Number.isFinite(at.getTime()) || !isUuid(id)) throw new Error('Invalid pagination row.')
  return `${at.toISOString()}|${id}`
}

export function decodeAiTimeCursor(cursor: unknown): AiTimeCursor | null {
  if (cursor === null || cursor === undefined || cursor === '') return null
  if (typeof cursor !== 'string' || cursor.length > 80) {
    throw new Error('Invalid pagination cursor.')
  }
  const separator = cursor.indexOf('|')
  if (separator <= 0 || cursor.indexOf('|', separator + 1) !== -1) {
    throw new Error('Invalid pagination cursor.')
  }
  const rawAt = cursor.slice(0, separator)
  const id = cursor.slice(separator + 1)
  const at = new Date(rawAt)
  if (!isUuid(id) || !Number.isFinite(at.getTime()) || at.toISOString() !== rawAt) {
    throw new Error('Invalid pagination cursor.')
  }
  return { at, id }
}
