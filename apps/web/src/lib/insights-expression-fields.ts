export type InsightsExpressionField = {
  value: string
  label: string
  group?: string | null
}

export function insightsExpressionFieldLabel(field: InsightsExpressionField): string {
  return field.group ? `${field.group} → ${field.label}` : field.label
}

/** Local schema metadata is already authorized and loaded; search it without truncation. */
export function filterInsightsExpressionFields(
  fields: readonly InsightsExpressionField[],
  query: string,
): InsightsExpressionField[] {
  const term = query.trim().toLowerCase()
  if (!term) return [...fields]
  return fields.filter((field) =>
    [field.label, field.group, insightsExpressionFieldLabel(field), field.value].some((value) =>
      value?.toLowerCase().includes(term),
    ),
  )
}
