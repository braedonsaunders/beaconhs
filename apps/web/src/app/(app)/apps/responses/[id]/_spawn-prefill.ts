// Pure helpers used by the response viewer to seed Create-CAPA / Create-incident
// drawer prefill state. Kept in its own file because the 'use server' actions
// file can only export async server actions.
//
// Lives next to _spawn-actions.ts (the server actions) and is consumed by
// page.tsx (server) to compute drawer titles and the failed-checks summary,
// which it then passes as plain props into the client drawers.

import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { DEFAULT_LOCALE, localizeText, type AppLocale } from '@beaconhs/i18n'
import { severityFromScore } from '../../_lib/score-router'

export function labelForField(
  schema: FormSchemaV1,
  fieldKey: string,
  locale: AppLocale = DEFAULT_LOCALE,
  defaultLocale: AppLocale = DEFAULT_LOCALE,
): string {
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.id === fieldKey) return localizeText(f.label, locale, fieldKey, defaultLocale)
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
  locale: AppLocale = DEFAULT_LOCALE,
  _defaultLocale: AppLocale = DEFAULT_LOCALE,
): string {
  const copy = SPAWN_COPY[locale]
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
    return [
      `${copy.row} ${rowIndex + 1}: ${displayRawValue((row as Record<string, unknown>)[fieldKey])}`,
    ]
  })
  if (answers.length === 0) return '—'

  const visible = answers.slice(0, 5)
  const remainder = answers.length - visible.length
  return `${visible.join('; ')}${remainder > 0 ? `; … (+${remainder} ${copy.more})` : ''}`
}

function failedFieldSummary(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
  failedKeys: string[],
  locale: AppLocale,
  defaultLocale: AppLocale,
): string {
  if (failedKeys.length === 0) return ''
  return failedKeys
    .map((k) => {
      const label = labelForField(schema, k, locale, defaultLocale)
      const display = displayValueForField(schema, values, k, locale)
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
  locale?: AppLocale
  defaultLocale?: AppLocale
}): SpawnPrefill {
  const locale = args.locale ?? DEFAULT_LOCALE
  const defaultLocale = args.defaultLocale ?? DEFAULT_LOCALE
  const copy = SPAWN_COPY[locale]
  const summary = failedFieldSummary(
    args.schema,
    args.values,
    args.singleFailedFieldKey ? [args.singleFailedFieldKey] : args.failedFieldKeys,
    locale,
    defaultLocale,
  )
  const caTitle = args.singleFailedFieldKey
    ? copy.fieldFailure(
        labelForField(args.schema, args.singleFailedFieldKey, locale, defaultLocale),
        args.templateName,
      )
    : copy.nonCompliance(args.templateName, args.reference)
  const caDescription = `${copy.generatedFrom(args.reference)} ${copy.complianceScore}: ${args.score}.${
    summary ? `\n\n${copy.failedChecks}:\n${summary}` : ''
  }`
  const incidentTitle = copy.incident(args.templateName, args.reference)
  const incidentDescription = `${copy.triggeredBy(args.reference)}${
    summary ? `\n\n${copy.observations}:\n${summary}` : ''
  }`
  return {
    caTitle,
    caDescription,
    caSeverity: severityFromScore(args.score),
    incidentTitle,
    incidentDescription,
  }
}

const SPAWN_COPY: Record<
  AppLocale,
  {
    row: string
    more: string
    fieldFailure: (field: string, app: string) => string
    nonCompliance: (app: string, reference: string) => string
    generatedFrom: (reference: string) => string
    complianceScore: string
    failedChecks: string
    incident: (app: string, reference: string) => string
    triggeredBy: (reference: string) => string
    observations: string
  }
> = {
  en: {
    row: 'Row',
    more: 'more',
    fieldFailure: (field, app) => `Address "${field}" failure in ${app}`,
    nonCompliance: (app, reference) => `Address non-compliance in ${app} (${reference})`,
    generatedFrom: (reference) => `Auto-generated from form response ${reference}.`,
    complianceScore: 'Compliance score',
    failedChecks: 'Failed checks',
    incident: (app, reference) => `Incident reported from ${app} (${reference})`,
    triggeredBy: (reference) => `Triggered by form response ${reference}.`,
    observations: 'Observations',
  },
  fr: {
    row: 'Ligne',
    more: 'autres',
    fieldFailure: (field, app) => `Corriger l’échec « ${field} » dans ${app}`,
    nonCompliance: (app, reference) => `Corriger la non-conformité dans ${app} (${reference})`,
    generatedFrom: (reference) => `Généré automatiquement à partir de la réponse ${reference}.`,
    complianceScore: 'Note de conformité',
    failedChecks: 'Vérifications échouées',
    incident: (app, reference) => `Incident signalé depuis ${app} (${reference})`,
    triggeredBy: (reference) => `Déclenché par la réponse au formulaire ${reference}.`,
    observations: 'Observations',
  },
  es: {
    row: 'Fila',
    more: 'más',
    fieldFailure: (field, app) => `Corregir el fallo de «${field}» en ${app}`,
    nonCompliance: (app, reference) => `Corregir el incumplimiento en ${app} (${reference})`,
    generatedFrom: (reference) => `Generado automáticamente desde la respuesta ${reference}.`,
    complianceScore: 'Puntuación de cumplimiento',
    failedChecks: 'Comprobaciones fallidas',
    incident: (app, reference) => `Incidente informado desde ${app} (${reference})`,
    triggeredBy: (reference) => `Activado por la respuesta del formulario ${reference}.`,
    observations: 'Observaciones',
  },
}
