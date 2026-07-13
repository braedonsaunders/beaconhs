// Pure helpers used by the response viewer to seed Create-CAPA / Create-incident
// drawer prefill state. Kept in its own file because the 'use server' actions
// file can only export async server actions.
//
// Lives next to _spawn-actions.ts (the server actions) and is consumed by
// page.tsx (server) to compute drawer titles and the failed-checks summary,
// which it then passes as plain props into the client drawers.

import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { severityFromScore } from '@/app/(app)/apps/_lib/score-router'

export function labelForField(schema: FormSchemaV1, fieldKey: string): string {
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.id === fieldKey) return f.label?.en ?? fieldKey
    }
  }
  return fieldKey
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
      const raw = values[k]
      const display =
        raw == null
          ? ''
          : typeof raw === 'string'
            ? raw
            : typeof raw === 'object' && raw && 'answer' in raw
              ? `${(raw as { answer?: string }).answer ?? ''}${
                  (raw as { comment?: string }).comment
                    ? ` — ${(raw as { comment?: string }).comment}`
                    : ''
                }`
              : JSON.stringify(raw)
      return `• ${label}${display ? ` — ${display}` : ''}`
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
