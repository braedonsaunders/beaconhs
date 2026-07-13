import 'server-only'

// Builds a generic `record_summary` PDF job from a flow's field-map — the
// branded key-value PDF used for modules without a bespoke renderer (journals,
// inspections). Reserved compliance keys are dropped; remaining values become
// labelled rows.

import { plainValue } from '@beaconhs/email-render'
import type { PdfEmailableJobData } from '@beaconhs/jobs'

const SKIP_KEYS = new Set(['compliance_score', 'compliance_status'])

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\bid\b/gi, 'ID')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function summarizeFlowValues(values: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(values)
    .filter(
      ([k, v]) =>
        !SKIP_KEYS.has(k) &&
        // FK / raw ids exist for flow conditions and recipient targets — they
        // are machine keys, not something a reader of the PDF can use.
        !/(^|_)ids?$/.test(k) &&
        // Raw enum twins ('status' next to 'status_label') would print twice —
        // keep the human label.
        !(`${k}_label` in values) &&
        v != null &&
        v !== '' &&
        // Collections render as sectioned tables (summarizeFlowCollections).
        typeof v !== 'object',
    )
    .map(([k, v]) => ({ label: humanize(k), value: plainValue(v) }))
    .filter((f) => f.value.trim() !== '')
}

type SummarySection = {
  label: string
  columns: { key: string; label: string }[]
  rows: Record<string, string>[]
  moreRows?: number
}
type SummaryPhoto = { url: string; caption?: string }

const MAX_SECTION_ROWS = 200
const MAX_SECTION_COLUMNS = 8

const isRowArray = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((r) => r != null && typeof r === 'object' && !Array.isArray(r))

/**
 * Turn a value map's row collections (inspection criteria, month log entries,
 * attendees, …) into printable table sections, and photo collections (rows
 * carrying a `url`) into an image list.
 */
function summarizeFlowCollections(values: Record<string, unknown>): {
  sections: SummarySection[]
  photos: SummaryPhoto[]
} {
  const sections: SummarySection[] = []
  const photos: SummaryPhoto[] = []
  for (const [key, v] of Object.entries(values)) {
    if (SKIP_KEYS.has(key) || !isRowArray(v)) continue
    // Photo-shaped rows (url + optional caption) print as images, not URLs.
    if (v.every((r) => typeof r.url === 'string')) {
      for (const r of v) {
        const url = String(r.url)
        if (url) photos.push({ url, caption: plainValue(r.caption ?? '') || undefined })
      }
      continue
    }
    // Column set = union of row keys (first-row order first), skipping machine
    // ids and columns that are empty on every row.
    const keys: string[] = []
    for (const row of v) {
      for (const k of Object.keys(row)) {
        if (!keys.includes(k) && !/(^|_)ids?$/.test(k)) keys.push(k)
      }
    }
    const rows = v.slice(0, MAX_SECTION_ROWS).map((row) => {
      const out: Record<string, string> = {}
      for (const k of keys) {
        const cell = row[k]
        out[k] = cell == null || typeof cell === 'object' ? '' : plainValue(cell)
      }
      return out
    })
    const columns = keys
      .filter((k) => rows.some((r) => (r[k] ?? '').trim() !== ''))
      .slice(0, MAX_SECTION_COLUMNS)
      .map((k) => ({ key: k, label: humanize(k) }))
    if (columns.length === 0 || rows.length === 0) continue
    sections.push({
      label: humanize(key),
      columns,
      rows,
      moreRows: v.length > MAX_SECTION_ROWS ? v.length - MAX_SECTION_ROWS : undefined,
    })
  }
  return { sections, photos }
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
  const { sections, photos } = summarizeFlowCollections(args.values)
  return {
    kind: 'record_summary',
    tenantId: args.tenantId,
    subjectId: args.subjectId,
    entityType: args.entityType,
    heading: args.heading,
    reference: asStr(args.reference),
    subtitle: asStr(args.subtitle),
    fields: summarizeFlowValues(args.values),
    sections: sections.length > 0 ? sections : undefined,
    photos: photos.length > 0 ? photos : undefined,
  }
}
