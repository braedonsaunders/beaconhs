// Server-side grading for assessment attempts.
// Pure function: given a question (kind + correctAnswer) and the user's answer,
// decide correct/incorrect/null. `text` questions never auto-grade — they are
// unscored: submitAssessmentAttempt excludes them from the points denominator
// and they render as recorded reference answers on the attempt page.
//
// Multi-choice canonicalisation: both `correctAnswer` and `answer` are
// comma-separated value lists. We sort + lowercase both before comparing so
// "A,B,C" matches "c,b,a".

export type QuestionKind = 'text' | 'single_choice' | 'multi_choice' | 'numeric' | 'true_false'
type ChoiceOption = { value: string; label: string }

function submittedChoiceOptions(options: unknown): ChoiceOption[] {
  if (!Array.isArray(options)) return []
  return options.filter(
    (option): option is ChoiceOption =>
      option != null &&
      typeof option === 'object' &&
      'value' in option &&
      typeof option.value === 'string' &&
      'label' in option &&
      typeof option.label === 'string',
  )
}

export function normalizeSubmittedAnswer(
  kind: QuestionKind,
  rawValues: string[],
  options: unknown,
  mandatory: boolean,
): string | null {
  const values = rawValues.map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) {
    if (mandatory) throw new Error('Answer every required question before submitting')
    return null
  }

  if (kind === 'text') return values[0] ?? null
  if (kind === 'numeric') {
    const value = values[0]
    if (!value || !Number.isFinite(Number(value))) throw new Error('Enter a valid number')
    return value
  }
  if (kind === 'true_false') {
    const value = values[0]
    if (value !== 'true' && value !== 'false') throw new Error('Choose true or false')
    return value
  }

  const choices = submittedChoiceOptions(options)
  if (choices.length < 2) throw new Error('This assessment question has no available choices')
  const allowed = new Set(choices.map((option) => option.value))
  if (values.some((value) => !allowed.has(value))) {
    throw new Error('An answer does not match the available choices')
  }
  if (kind === 'single_choice') {
    if (values.length !== 1) throw new Error('Choose one answer')
    return values[0] ?? null
  }

  const selected = new Set(values)
  return choices
    .filter((option) => selected.has(option.value))
    .map((option) => option.value)
    .join(',')
}

export function gradeAnswer(
  kind: QuestionKind,
  correctAnswer: string | null,
  userAnswer: string | null,
): boolean | null {
  if (kind === 'text') return null // never auto-grade free text
  if (userAnswer == null || userAnswer.trim().length === 0) return false
  if (correctAnswer == null || correctAnswer.trim().length === 0) return null

  const ua = userAnswer.trim()
  const ca = correctAnswer.trim()

  if (kind === 'single_choice' || kind === 'true_false') {
    return ua.toLowerCase() === ca.toLowerCase()
  }
  if (kind === 'numeric') {
    const a = Number(ua)
    const b = Number(ca)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return Math.abs(a - b) < 1e-9
  }
  if (kind === 'multi_choice') {
    const norm = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join('|')
    return norm(ua) === norm(ca)
  }
  return null
}
