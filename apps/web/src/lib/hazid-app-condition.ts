export type HazidAppCondition = {
  questionId: string
  operator: 'equals'
  value: string
}

export type HazidAppConfig = {
  condition?: HazidAppCondition
}

export function parseHazidAppConfig(value: unknown): HazidAppConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const condition = (value as { condition?: unknown }).condition
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return {}
  const raw = condition as Record<string, unknown>
  if (
    typeof raw.questionId !== 'string' ||
    raw.questionId.length === 0 ||
    raw.operator !== 'equals' ||
    typeof raw.value !== 'string' ||
    raw.value.trim().length === 0
  ) {
    return {}
  }
  return {
    condition: {
      questionId: raw.questionId,
      operator: 'equals',
      value: raw.value.trim(),
    },
  }
}

export function buildHazidAppConfig(
  questionId: string | null | undefined,
  value: string | null | undefined,
): HazidAppConfig {
  const normalizedQuestionId = questionId?.trim() ?? ''
  const normalizedValue = value?.trim() ?? ''
  if (!normalizedQuestionId && !normalizedValue) return {}
  if (!normalizedQuestionId || !normalizedValue) {
    throw new Error('Choose both a question and the answer that should show this app')
  }
  return {
    condition: {
      questionId: normalizedQuestionId,
      operator: 'equals',
      value: normalizedValue,
    },
  }
}

export function hazidAppIsApplicable(
  config: unknown,
  answersByTypeQuestionId: ReadonlyMap<string, string | null>,
): boolean {
  const condition = parseHazidAppConfig(config).condition
  if (!condition) return true
  const answer = answersByTypeQuestionId.get(condition.questionId)?.trim()
  if (!answer) return false
  return answer.localeCompare(condition.value, undefined, { sensitivity: 'accent' }) === 0
}
