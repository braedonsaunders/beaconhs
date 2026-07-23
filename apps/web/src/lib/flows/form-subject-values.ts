import 'server-only'

// Companion-value projections for Builder FORM subjects.
//
// A form response's raw `data` map stays untouched in loadValues() — flow
// conditions, recipient `field` targets, and actions like analyze_photos all
// read raw values. But raw values are often unreadable in a document (picker
// ids, {answer, comment} objects, ISO datetimes), so the form flow adapter
// derives readable COMPANION keys per field. WHICH companions exist per field
// type is declared in @beaconhs/forms-core's form-companions.ts (shared with
// the palette in subject-fields.ts and the PDF template generator); this
// module renders the companion VALUES.

import { entityDisplayName, entityKindForPicker, type FormField } from '@beaconhs/forms-core'
import type { Annotation } from '@beaconhs/db/schema'
import { photoDocumentUrl } from '../photo-document-url'

type AttachedFileRow = {
  attachmentId?: string
  filename?: string
  url?: string
  caption?: string
  annotations?: Annotation[]
  width?: number
  height?: number
}

/** Flatten photo attachments and render their non-destructive markup for documents. */
export function nestedPhotoRows(
  raw: unknown,
): { url: string; filename: string; caption: string }[] {
  const atts =
    raw && typeof raw === 'object' && Array.isArray((raw as { attachments?: unknown }).attachments)
      ? ((raw as { attachments: unknown[] }).attachments as AttachedFileRow[])
      : []
  return atts
    .filter((a) => a && typeof a === 'object' && typeof a.url === 'string' && a.url.length > 0)
    .map((a) => ({
      url: photoDocumentUrl({
        url: a.url!,
        annotations: Array.isArray(a.annotations) ? a.annotations : null,
        width: typeof a.width === 'number' ? a.width : null,
        height: typeof a.height === 'number' ? a.height : null,
      }),
      filename: a.filename ?? '',
      caption: a.caption ?? '',
    }))
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
 * Human-readable text for one field value. `entityAttrs` is the picker's loaded attr map
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
    case 'photo': {
      const val = (raw && typeof raw === 'object' ? raw : {}) as {
        attachments?: Array<{
          caption?: string
          annotations?: Array<{ type?: string; text?: string }>
        }>
        analysis?: {
          summary?: string
          overallRisk?: string
          ppe?: { item: string; status: string }[]
          hazards?: { type: string; severity: string }[]
        }
      }
      const n = val.attachments?.length ?? 0
      const a = val.analysis
      const parts = [
        `${n} photo${n === 1 ? '' : 's'}${a?.overallRisk ? ` · risk ${a.overallRisk}` : ''}`,
      ]
      const notes = (val.attachments ?? []).flatMap((attachment) => [
        ...(attachment.caption?.trim() ? [attachment.caption.trim()] : []),
        ...(attachment.annotations ?? [])
          .filter(
            (annotation) =>
              annotation.type === 'text' &&
              typeof annotation.text === 'string' &&
              annotation.text.trim().length > 0,
          )
          .map((annotation) => annotation.text!.trim()),
      ])
      if (notes.length) parts.push(`Notes: ${notes.join('; ')}`)
      if (!a) return parts.join('; ')
      if (a.summary) parts.push(a.summary)
      if (a.hazards?.length)
        parts.push(`Hazards: ${a.hazards.map((h) => `${h.type} (${h.severity})`).join(', ')}`)
      const badPpe = (a.ppe ?? []).filter((p) => p.status !== 'present')
      if (badPpe.length) parts.push(`PPE: ${badPpe.map((p) => p.item).join(', ')}`)
      return parts.join('; ')
    }
    case 'datetime':
      return fmtDateTimeText(raw)
    default:
      return String(raw)
  }
}
