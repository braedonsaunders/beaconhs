export const ASSESSMENT_QUESTION_KINDS = [
  'text',
  'single_choice',
  'multi_choice',
  'numeric',
  'true_false',
] as const

export type AssessmentQuestionKind = (typeof ASSESSMENT_QUESTION_KINDS)[number]
export type AssessmentChoiceOption = { value: string; label: string }

const MAX_CHOICE_OPTIONS = 50
const MAX_CHOICE_LABEL_LENGTH = 500
const MAX_CHOICE_VALUE_LENGTH = 100

function parseChoiceOptions(raw: string): AssessmentChoiceOption[] {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    throw new Error('Choices are invalid. Add each choice with the option editor.')
  }
  if (!Array.isArray(candidate)) throw new Error('Choices are invalid')
  if (candidate.length < 2) throw new Error('Add at least two choices')
  if (candidate.length > MAX_CHOICE_OPTIONS) {
    throw new Error(`A question can have at most ${MAX_CHOICE_OPTIONS} choices`)
  }

  const options = candidate.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Choices are invalid')
    const value = 'value' in item && typeof item.value === 'string' ? item.value.trim() : ''
    const label = 'label' in item && typeof item.label === 'string' ? item.label.trim() : ''
    if (!value || value.includes(',') || value.length > MAX_CHOICE_VALUE_LENGTH) {
      throw new Error('A choice is invalid')
    }
    if (!label) throw new Error('Every choice needs text')
    if (label.length > MAX_CHOICE_LABEL_LENGTH) {
      throw new Error(`Choice text cannot exceed ${MAX_CHOICE_LABEL_LENGTH} characters`)
    }
    return { value, label }
  })

  if (new Set(options.map((option) => option.value)).size !== options.length) {
    throw new Error('Each choice must have a unique value')
  }
  if (new Set(options.map((option) => option.label.toLocaleLowerCase())).size !== options.length) {
    throw new Error('Each choice must have unique text')
  }
  return options
}

export function parseAssessmentQuestionChoices(
  kind: AssessmentQuestionKind,
  optionsRaw: string,
  correctAnswerRaw: string,
): { options: AssessmentChoiceOption[] | null; correctAnswer: string | null } {
  if (kind === 'text') return { options: null, correctAnswer: null }
  if (kind === 'true_false') {
    if (correctAnswerRaw !== 'true' && correctAnswerRaw !== 'false') {
      throw new Error('Choose the correct answer')
    }
    return {
      options: [
        { value: 'true', label: 'True' },
        { value: 'false', label: 'False' },
      ],
      correctAnswer: correctAnswerRaw,
    }
  }
  if (kind === 'numeric') {
    const correctAnswer = correctAnswerRaw.trim()
    if (!correctAnswer || !Number.isFinite(Number(correctAnswer))) {
      throw new Error('Enter a valid numeric correct answer')
    }
    return { options: null, correctAnswer }
  }

  const options = parseChoiceOptions(optionsRaw)
  const values = new Set(options.map((option) => option.value))
  if (kind === 'single_choice') {
    const correctAnswer = correctAnswerRaw.trim()
    if (!values.has(correctAnswer)) throw new Error('Choose the correct answer')
    return { options, correctAnswer }
  }

  const selected = new Set(
    correctAnswerRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  if (selected.size === 0) throw new Error('Choose at least one correct answer')
  if ([...selected].some((value) => !values.has(value))) {
    throw new Error('A correct answer does not match the available choices')
  }
  return {
    options,
    correctAnswer: options
      .filter((option) => selected.has(option.value))
      .map((option) => option.value)
      .join(','),
  }
}
