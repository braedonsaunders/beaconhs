// Pure helpers used by the response viewer to seed Create-CAPA / Create-incident
// drawer prefill state. Kept in its own file because the 'use server' actions
// file can only export async server actions.
//
// Lives next to _spawn-actions.ts (the server actions) and is consumed by
// page.tsx (server) to compute drawer titles and the failed-checks summary,
// which it then passes as plain props into the client drawers.

import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { severityFromScore } from '../../_lib/score-router'

export function labelForField(schema: FormSchemaV1, fieldKey: string): string {
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.id === fieldKey) return f.label?.en ?? fieldKey
    }
  }
  return fieldKey
}

function displayRawValue(raw: unknown): string {
  if (raw == null) return '—'
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  if (typeof raw === 'object' && 'answer' in raw) {
    const answer = String((raw as { answer?: unknown }).answer ?? '—')
    const comment = (raw as { comment?: unknown }).comment
    return typeof comment === 'string' && comment ? `${answer} — ${comment}` : answer
  }
  return JSON.stringify(raw)
}

/**
 * Resolve a failed field's response value from the canonical payload shape.
 * Repeating fields live under their section id, so a plain `values[fieldKey]`
 * lookup would lose the evidence shown in the response viewer and CAPA prefill.
 */
export function displayValueForField(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
  fieldKey: string,
): string {
  const section = schema.sections.find((candidate) =>
    candidate.fields.some((field) => field.id === fieldKey),
  )
  if (!section?.repeating) return displayRawValue(values[fieldKey])

  const rows = values[section.id]
  if (!Array.isArray(rows)) return '—'
  const answers = rows.flatMap((row, rowIndex) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row) || !(fieldKey in row)) {
      return []
    }
    return [`Row ${rowIndex + 1}: ${displayRawValue((row as Record<string, unknown>)[fieldKey])}`]
  })
  if (answers.length === 0) return '—'

  const visible = answers.slice(0, 5)
  const remainder = answers.length - visible.length
  return `${visible.join('; ')}${remainder > 0 ? `; … (+${remainder} more)` : ''}`
}

function failedFieldSummary(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
  failedKeys: string[],
): string {
  if (failedKeys.length === 0) return ''
  return failedKeys
    .map((k) => {
      const label = labelForField(schema, k)
      const display = displayValueForField(schema, values, k)
      return `• ${label}${display === '—' ? '' : ` — ${display}`}`
    })
    .join('\n')
}

export type SpawnPrefill = {
  caTitle: string
  caDescription: string
  caSeverity: 'low' | 'medium' | 'high' | 'critical'
  incidentTitle: string
  incidentDescription: string
}

export function buildSpawnPrefill(args: {
  templateName: string
  reference: string
  score: number
  schema: FormSchemaV1
  values: Record<string, unknown>
  failedFieldKeys: string[]
  singleFailedFieldKey?: string | null
}): SpawnPrefill {
  const summary = failedFieldSummary(
    args.schema,
    args.values,
    args.singleFailedFieldKey ? [args.singleFailedFieldKey] : args.failedFieldKeys,
  )
  const caTitle = args.singleFailedFieldKey
    ? `Address "${labelForField(args.schema, args.singleFailedFieldKey)}" failure in ${args.templateName}`
    : `Address non-compliance in ${args.templateName} (${args.reference})`
  const caDescription = `Auto-generated from form response ${args.reference}. Compliance score: ${args.score}.${
    summary ? `\n\nFailed checks:\n${summary}` : ''
  }`
  const incidentTitle = `Incident reported from ${args.templateName} (${args.reference})`
  const incidentDescription = `Triggered by form response ${args.reference}.${
    summary ? `\n\nObservations:\n${summary}` : ''
  }`
  return {
    caTitle,
    caDescription,
    caSeverity: severityFromScore(args.score),
    incidentTitle,
    incidentDescription,
  }
}
