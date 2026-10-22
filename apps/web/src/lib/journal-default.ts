/** App-owned employee default; unset employees use Worker regardless of access roles. */
export function employeeJournalDefault(
  metadata: Record<string, unknown>,
): 'worker' | 'supervisor' | null {
  const value = metadata.journalDefinition
  return value === 'worker' || value === 'supervisor' ? value : null
}

export function resolveJournalDefault(metadata: Record<string, unknown>): 'worker' | 'supervisor' {
  return employeeJournalDefault(metadata) ?? 'worker'
}
