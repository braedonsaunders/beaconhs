export const INSPECTION_RESPONSE_TYPES = [
  'pass_fail_na',
  'yes_no',
  'choice',
  'text',
  'long_text',
  'number',
] as const

export type AuthorableInspectionResponseType = (typeof INSPECTION_RESPONSE_TYPES)[number]
export type InspectionResponseType = AuthorableInspectionResponseType | 'rating'

export const INSPECTION_RESPONSE_LABELS: Record<InspectionResponseType, string> = {
  pass_fail_na: 'Pass / Fail / N-A',
  yes_no: 'Yes / No',
  choice: 'Select one',
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  // Historical rating rows were always answered with the outcome control.
  // Keep that display contract until a separately-configured rating scale exists.
  rating: 'Pass / Fail / N-A',
}

const MAX_INSPECTION_CHOICE_OPTIONS = 50
const MAX_INSPECTION_CHOICE_OPTION_LENGTH = 200
export const MAX_INSPECTION_TEXT_ANSWER_LENGTH = 100_000
const MAX_INSPECTION_NUMBER_ANSWER_LENGTH = 100

const INSPECTION_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

type InspectionResponseConfig = {
  responseType: AuthorableInspectionResponseType
  choiceOptions: string[]
}

export function normalizeInspectionChoiceOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('Choice options must be a list')
  if (raw.length > MAX_INSPECTION_CHOICE_OPTIONS) {
    throw new Error(`Choice questions support up to ${MAX_INSPECTION_CHOICE_OPTIONS} options`)
  }

  const options: string[] = []
  const normalized = new Set<string>()
  for (const candidate of raw) {
    if (typeof candidate !== 'string') throw new Error('Every choice option must be text')
    const option = candidate.trim()
    if (!option) continue
    if (option.length > MAX_INSPECTION_CHOICE_OPTION_LENGTH) {
      throw new Error(
        `Each choice option must be ${MAX_INSPECTION_CHOICE_OPTION_LENGTH} characters or fewer`,
      )
    }
    const key = option.toLocaleLowerCase('en-US')
    if (normalized.has(key)) throw new Error(`Choice option "${option}" is duplicated`)
    normalized.add(key)
    options.push(option)
  }

  if (options.length < 2) throw new Error('Choice questions require at least two options')
  return options
}

export function parseInspectionResponseConfig(
  responseType: unknown,
  choiceOptions: unknown,
): InspectionResponseConfig {
  const type =
    typeof responseType === 'string' &&
    (INSPECTION_RESPONSE_TYPES as readonly string[]).includes(responseType)
      ? (responseType as AuthorableInspectionResponseType)
      : 'pass_fail_na'
  return {
    responseType: type,
    choiceOptions: type === 'choice' ? normalizeInspectionChoiceOptions(choiceOptions) : [],
  }
}

export function parseInspectionChoiceOptionsText(raw: string): string[] {
  return normalizeInspectionChoiceOptions(raw.split(/\r?\n/))
}

export function normalizeInspectionTextAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') throw new Error('Inspection text answers must be text')
  const value = raw.trim()
  if (!value) return null
  if (value.length > MAX_INSPECTION_TEXT_ANSWER_LENGTH) {
    throw new Error(
      `Inspection text answers must be ${MAX_INSPECTION_TEXT_ANSWER_LENGTH.toLocaleString('en-US')} characters or fewer`,
    )
  }
  return value
}

/**
 * Return a PostgreSQL-numeric-compatible string without converting through a
 * JavaScript number. Avoiding Number() preserves large and precise decimals.
 */
export function normalizeInspectionNumberAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') throw new Error('Inspection number answers must be text input')
  const value = raw.trim()
  if (!value) return null
  if (
    value.length > MAX_INSPECTION_NUMBER_ANSWER_LENGTH ||
    !INSPECTION_NUMBER_PATTERN.test(value)
  ) {
    throw new Error('Enter a valid number')
  }
  return value
}

export function isInspectionOutcomeResponseType(
  type: InspectionResponseType,
): type is 'pass_fail_na' | 'rating' | 'yes_no' {
  return type === 'pass_fail_na' || type === 'rating' || type === 'yes_no'
}

export function inspectionCriterionIsAnswered(input: {
  responseType: InspectionResponseType
  outcomeAnswer: 'pass' | 'fail' | 'n_a' | null
  choiceAnswer: string | null
  textAnswer: string | null
  numberAnswer: string | null
}): boolean {
  if (input.responseType === 'choice') return Boolean(input.choiceAnswer)
  if (input.responseType === 'text' || input.responseType === 'long_text') {
    return Boolean(input.textAnswer)
  }
  if (input.responseType === 'number') return input.numberAnswer !== null
  return Boolean(input.outcomeAnswer)
}

export function inspectionCriterionDisplayAnswer(input: {
  responseType: InspectionResponseType
  outcomeAnswer: 'pass' | 'fail' | 'n_a' | null
  choiceAnswer: string | null
  textAnswer: string | null
  numberAnswer: string | null
}): string | null {
  if (input.responseType === 'choice') return input.choiceAnswer
  if (input.responseType === 'text' || input.responseType === 'long_text') {
    return input.textAnswer
  }
  if (input.responseType === 'number') return input.numberAnswer
  if (!input.outcomeAnswer) return null
  if (input.responseType === 'yes_no') {
    return input.outcomeAnswer === 'pass' ? 'Yes' : input.outcomeAnswer === 'fail' ? 'No' : 'N/A'
  }
  return input.outcomeAnswer === 'pass' ? 'Pass' : input.outcomeAnswer === 'fail' ? 'Fail' : 'N/A'
}
