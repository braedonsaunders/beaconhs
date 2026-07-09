import 'server-only'

// Companion-value projections for Builder FORM subjects.
//
// A form response's raw `data` map stays untouched in loadValues() — flow
// conditions, recipient `field` targets, and actions like analyze_photos all
// read raw values. But raw values are often unreadable in a document (picker
// ids, {answer, comment} objects, ISO datetimes), so the form flow adapter
// derives COMPANION keys the same way the bespoke renderFormPdf renders each
// field, and this module is the single source of truth for which companions
// exist so the palette (subject-fields.ts) always matches the value map:
//
//   {{<fieldId>}}          the raw stored value (unchanged, back-compat)
//   {{<fieldId>_text}}     human-readable text (pickers → entity names,
//                          multi-selects joined, objects flattened, …)
//   {{<fieldId>_image}}    an embeddable image URL (sketch fields; signature
//                          fields need no companion — their raw value IS the
//                          PNG data URL, usable directly in <img src="…">)
//   {{#each <fieldId>}}    photo/file fields — the raw AttachedFile rows
//                          already carry {url, filename}
//   {{#each <fieldId>_photos}}  photo_ai / photo_annotated — their nested
//                          attachments flattened to {url, filename} rows
//   {{#each <sectionId>}}  repeating sections — raw row objects keyed by the
//                          section's field ids
//   {{#each <fieldId>}}    table fields — raw row objects keyed by column key

import {
  entityDisplayName,
  entityKindForPicker,
  type FormField,
  type I18nString,
} from '@beaconhs/forms-core'

/** Content-only field types that carry no mergeable value. */
export const SKIP_FIELD_TYPES = new Set(['heading', 'paragraph', 'divider', 'image', 'metric'])

/** Resolve an i18n label to plain text (en-first), falling back to the id. */
export function labelText(l: I18nString | undefined, fallback: string): string {
  if (typeof l === 'string') return l || fallback
  if (l && typeof l === 'object' && typeof l.en === 'string') return l.en || fallback
  return fallback
}

// Field types whose raw stored value is unreadable in a document — these get a
// `<id>_text` companion in loadValues() and in the palette.
const TEXT_COMPANION_TYPES = new Set([
  'multi_person_picker',
  'multi_select',
  'checkbox_group',
  'ranking',
  'yes_no_comment',
  'gps',
  'matrix',
  'address',
  'risk_matrix',
  'typed_attestation',
  'data_table',
  'photo_ai',
  'photo_annotated',
  'datetime',
])

export function hasTextCompanion(type: string): boolean {
  return TEXT_COMPANION_TYPES.has(type) || entityKindForPicker(type) !== null
}

/** Sketch stores `{url}` — expose the URL as `<id>_image`. */
export function hasImageCompanion(type: string): boolean {
  return type === 'sketch'
}

/** Object-valued photo fields whose attachments nest under `.attachments`. */
export function hasPhotosCompanion(type: string): boolean {
  return type === 'photo_ai' || type === 'photo_annotated'
}

/** Array-of-AttachedFile fields — raw rows already carry {url, filename}. */
export function isAttachmentArrayField(type: string): boolean {
  return ['photo', 'photo_upload', 'file', 'video', 'audio'].includes(type)
}

type AttachedFileRow = { attachmentId?: string; filename?: string; url?: string }

/** Flatten photo_ai / photo_annotated nested attachments to {url, filename} rows. */
export function nestedPhotoRows(raw: unknown): { url: string; filename: string }[] {
  const atts =
    raw && typeof raw === 'object' && Array.isArray((raw as { attachments?: unknown }).attachments)
      ? ((raw as { attachments: unknown[] }).attachments as AttachedFileRow[])
      : []
  return atts
    .filter((a) => a && typeof a === 'object' && typeof a.url === 'string' && a.url.length > 0)
    .map((a) => ({ url: a.url!, filename: a.filename ?? '' }))
}

/** Sketch value → embeddable image URL ('' when unset). */
export function sketchImageUrl(raw: unknown): string {
  const url = raw && typeof raw === 'object' ? (raw as { url?: unknown }).url : null
  return typeof url === 'string' ? url : ''
}

function fmtDateTimeText(raw: unknown): string {
  const d = typeof raw === 'string' || raw instanceof Date ? new Date(raw) : null
  if (!d || Number.isNaN(d.getTime())) return raw == null ? '' : String(raw)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Human-readable text for one field value — the plain-text twin of the bespoke
 * renderFormPdf's renderValue(). `entityAttrs` is the picker's loaded attr map
 * (from loadEntitiesForFormPickers); `personNameById` resolves ids picked by a
 * multi_person_picker.
 */
export function renderFormFieldText(
  field: Pick<FormField, 'type' | 'config'>,
  raw: unknown,
  opts: {
    entityAttrs?: Record<string, unknown> | null
    personNameById?: (id: string) => string | undefined
  } = {},
): string {
  if (raw === undefined || raw === null || raw === '') return ''

  if (entityKindForPicker(field.type)) {
    return entityDisplayName(opts.entityAttrs) ?? String(raw)
  }

  switch (field.type) {
    case 'multi_person_picker': {
      const ids = Array.isArray(raw) ? raw.map(String) : [String(raw)]
      return ids.map((id) => opts.personNameById?.(id) ?? id).join(', ')
    }
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(raw) ? raw.map(String).join(', ') : String(raw)
    case 'ranking': {
      const order = Array.isArray(raw) ? raw.map(String) : []
      return order.map((v, i) => `${i + 1}. ${v}`).join(', ')
    }
    case 'yes_no_comment': {
      const v = raw as { answer?: string; comment?: string }
      return `${v.answer ?? ''}${v.comment ? ` (${v.comment})` : ''}`.trim()
    }
    case 'gps': {
      const v = raw as { lat?: number; lng?: number; accuracy?: number }
      if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return ''
      return `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}${v.accuracy ? ` (±${Math.round(v.accuracy)}m)` : ''}`
    }
    case 'matrix': {
      const v = raw as Record<string, string>
      const cfg = (field.config ?? {}) as {
        rows?: { key: string; label: string }[]
        scale?: { value: string; label: string }[]
      }
      const rows = cfg.rows ?? []
      const scale = cfg.scale ?? []
      const scaleLabel = (val: string) => scale.find((s) => s.value === val)?.label ?? val
      const entries = rows.length
        ? rows.filter((r) => v[r.key]).map((r) => [r.label, v[r.key]!] as const)
        : Object.entries(v)
      return entries.map(([label, val]) => `${label}: ${scaleLabel(val)}`).join('; ')
    }
    case 'address': {
      const a = raw as {
        line1?: string
        city?: string
        region?: string
        postal?: string
        country?: string
        query?: string
      }
      const lines = [
        a.line1,
        [a.city, a.region, a.postal].filter(Boolean).join(', '),
        a.country,
      ].filter(Boolean)
      return lines.length ? lines.join(', ') : (a.query ?? '')
    }
    case 'risk_matrix': {
      const v = raw as { severity?: string; likelihood?: string; score?: number; label?: string }
      return `${v.severity ?? ''} × ${v.likelihood ?? ''} = ${v.label ?? String(v.score ?? '')}`
    }
    case 'typed_attestation': {
      const v = raw as { name?: string; agreed?: boolean }
      return `${v.name ?? ''}${v.agreed ? ' — agreed' : ''}`.trim()
    }
    case 'data_table': {
      const ids = Array.isArray(raw) ? raw : []
      return ids.length ? `${ids.length} record${ids.length === 1 ? '' : 's'} selected` : ''
    }
    case 'photo_ai': {
      const val = raw as {
        attachments?: unknown[]
        analysis?: {
          summary?: string
          overallRisk?: string
          ppe?: { item: string; status: string }[]
          hazards?: { type: string; severity: string }[]
        }
      }
      const n = val.attachments?.length ?? 0
      const a = val.analysis
      if (!a) return `${n} photo${n === 1 ? '' : 's'}`
      const parts = [
        `${n} photo${n === 1 ? '' : 's'}${a.overallRisk ? ` · risk ${a.overallRisk}` : ''}`,
      ]
      if (a.summary) parts.push(a.summary)
      if (a.hazards?.length)
        parts.push(`Hazards: ${a.hazards.map((h) => `${h.type} (${h.severity})`).join(', ')}`)
      const badPpe = (a.ppe ?? []).filter((p) => p.status !== 'present')
      if (badPpe.length) parts.push(`PPE: ${badPpe.map((p) => p.item).join(', ')}`)
      return parts.join('; ')
    }
    case 'photo_annotated': {
      const val = raw as { attachments?: unknown[]; markers?: { label: string }[] }
      const n = val.attachments?.length ?? 0
      const markers = Array.isArray(val.markers) ? val.markers : []
      const head = `${n} photo${n === 1 ? '' : 's'}, ${markers.length} marker${markers.length === 1 ? '' : 's'}`
      return markers.length
        ? `${head}: ${markers.map((m, i) => `${i + 1}. ${m.label || '(no note)'}`).join('; ')}`
        : head
    }
    case 'datetime':
      return fmtDateTimeText(raw)
    default:
      return String(raw)
  }
}
