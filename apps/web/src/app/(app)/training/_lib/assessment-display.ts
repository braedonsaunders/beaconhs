/** Shared rendering of immutable assessment answer snapshots in the page and reports. */
export function validChoiceOptions(options: unknown): { value: string; label: string }[] {
  if (!Array.isArray(options)) return []
  return options.filter(
    (option): option is { value: string; label: string } =>
      option !== null &&
      typeof option === 'object' &&
      typeof option.value === 'string' &&
      typeof option.label === 'string',
  )
}

export function formatAssessmentAnswer(
  answer: string | null | undefined,
  kind: string,
  options: unknown,
): string {
  if (answer == null || answer === '') return ''
  if (kind === 'true_false')
    return answer.toLowerCase() === 'true'
      ? 'True'
      : answer.toLowerCase() === 'false'
        ? 'False'
        : answer
  if (kind !== 'single_choice' && kind !== 'multi_choice') return answer
  const labels = new Map(validChoiceOptions(options).map((option) => [option.value, option.label]))
  return answer
    .split(',')
    .map((value) => labels.get(value.trim()) ?? value.trim())
    .filter(Boolean)
    .join(', ')
}

export function assessmentOptionsText(options: unknown): string {
  return validChoiceOptions(options)
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join('\n')
}
