import 'server-only'

// Builds a generic `record_summary` PDF job from a flow's field-map — the
// branded key-value PDF used for modules without a bespoke renderer (journals,
// inspections). Reserved compliance keys are dropped; remaining values become
// labelled rows.

import type { PdfEmailableJobData } from '@beaconhs/jobs'

const SKIP_KEYS = new Set(['compliance_score', 'compliance_status'])

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\bid\b/gi, 'ID')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function summarizeFlowValues(
  values: Record<string, unknown>,
): { label: string; value: string }[] {
  return Object.entries(values)
    .filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && v !== '')
    .map(([k, v]) => ({ label: humanize(k), value: String(v) }))
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

export function buildRecordSummaryPdfJob(args: {
  tenantId: string
  subjectId: string
  entityType: string
  heading: string
  reference?: unknown
  subtitle?: unknown
  values: Record<string, unknown>
}): PdfEmailableJobData {
  return {
    kind: 'record_summary',
    tenantId: args.tenantId,
    subjectId: args.subjectId,
    entityType: args.entityType,
    heading: args.heading,
    reference: asStr(args.reference),
    subtitle: asStr(args.subtitle),
    fields: summarizeFlowValues(args.values),
  }
}
