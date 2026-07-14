export const MAX_JOURNAL_AI_SOURCE_LENGTH = 8_000
export const MAX_JOURNAL_AI_TONE_LENGTH = 100
export const MAX_JOURNAL_AI_CONTEXT_LENGTH = 2_000

type JournalAiTextInput = {
  text: string
  tone?: string
  context?: string
}

type JournalAiTextInputResult =
  { ok: true; value: JournalAiTextInput } | { ok: false; error: string }

export function parseJournalAiTextInput(value: unknown): JournalAiTextInputResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Bad request' }
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    return { ok: false, error: 'Nothing to work with' }
  }
  if (candidate.text.length > MAX_JOURNAL_AI_SOURCE_LENGTH) {
    return {
      ok: false,
      error: `Select ${MAX_JOURNAL_AI_SOURCE_LENGTH.toLocaleString()} characters or fewer for AI assist`,
    }
  }

  const optionalText = (
    key: 'tone' | 'context',
    maxLength: number,
  ): { ok: true; value?: string } | { ok: false; error: string } => {
    const field = candidate[key]
    if (field === undefined || field === null) return { ok: true }
    if (typeof field !== 'string') return { ok: false, error: `Invalid ${key}` }
    if (field.length > maxLength) {
      return { ok: false, error: `${key[0]!.toUpperCase()}${key.slice(1)} is too long` }
    }
    return { ok: true, value: field }
  }

  const tone = optionalText('tone', MAX_JOURNAL_AI_TONE_LENGTH)
  if (!tone.ok) return tone
  const context = optionalText('context', MAX_JOURNAL_AI_CONTEXT_LENGTH)
  if (!context.ok) return context

  return {
    ok: true,
    value: {
      text: candidate.text,
      ...(tone.value !== undefined ? { tone: tone.value } : {}),
      ...(context.value !== undefined ? { context: context.value } : {}),
    },
  }
}
