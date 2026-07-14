import { isUuid } from '../list-params'

export const MAX_SHARE_TARGET_QUERY_CHARS = 100

type ShareTargetSearchInput = {
  conversationId: string
  targetType: 'user' | 'role'
  query: string
  selected: string | null
}

export function parseShareTargetSearchInput(input: unknown): ShareTargetSearchInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid share target search.')
  }
  const value = input as Record<string, unknown>
  if (
    !isUuid(typeof value.conversationId === 'string' ? value.conversationId : '') ||
    (value.targetType !== 'user' && value.targetType !== 'role') ||
    typeof value.query !== 'string' ||
    value.query.length > MAX_SHARE_TARGET_QUERY_CHARS ||
    (value.selected !== null &&
      value.selected !== undefined &&
      !isUuid(typeof value.selected === 'string' ? value.selected : ''))
  ) {
    throw new Error('Invalid share target search.')
  }
  return {
    conversationId: value.conversationId as string,
    targetType: value.targetType,
    query: value.query.trim(),
    selected: typeof value.selected === 'string' ? value.selected : null,
  }
}

export function escapeShareTargetSearch(query: string): string {
  return query.replace(/[%_\\]/g, (match) => `\\${match}`)
}
