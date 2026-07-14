import {
  storesResponseValue,
  type FieldType,
  type FormField,
  type FormSchemaV1,
  type FormSection,
} from '@beaconhs/forms-core'
import type { ExportColumn } from '@/lib/export-columns'

export type ResponseExportColumn = ExportColumn & {
  source: 'response' | 'field' | 'section'
  fieldId?: string
  sectionId?: string
  fieldType?: FieldType
}

type ResponseExportContext = {
  response: {
    id: string
    status: string
    currentStep: string | null
    createdAt: Date
    updatedAt: Date
    submittedAt: Date | null
    closedAt: Date | null
    locked: boolean
    complianceScore: string | number | null
    complianceStatus: string | null
    monitorStatus: string | null
    sourceEntityType: string | null
    sourceEntityId: string | null
  }
  template: {
    name: string
    category: string | null
    kind: string
  }
  version: {
    version: number
  }
  siteName: string | null
  subjectName: string | null
  submittedByName: string | null
  values: Record<string, unknown>
}

const RESPONSE_EXPORT_BASE_COLUMNS: ResponseExportColumn[] = [
  { key: 'response_id', label: 'Response ID', source: 'response' },
  { key: 'app', label: 'App', source: 'response' },
  { key: 'category', label: 'Category', source: 'response' },
  { key: 'kind', label: 'Kind', source: 'response' },
  { key: 'version', label: 'Version', source: 'response' },
  { key: 'status', label: 'Status', source: 'response' },
  { key: 'current_step', label: 'Current step', source: 'response' },
  { key: 'site', label: 'Site', source: 'response' },
  { key: 'subject', label: 'Subject', source: 'response' },
  { key: 'submitted_by', label: 'Submitted by', source: 'response' },
  { key: 'created_at', label: 'Created', source: 'response' },
  { key: 'updated_at', label: 'Updated', source: 'response' },
  { key: 'submitted_at', label: 'Submitted', source: 'response' },
  { key: 'closed_at', label: 'Closed', source: 'response' },
  { key: 'locked', label: 'Locked', source: 'response' },
  { key: 'compliance_score', label: 'Compliance score', source: 'response' },
  { key: 'compliance_status', label: 'Compliance status', source: 'response' },
  { key: 'monitor_status', label: 'Monitor status', source: 'response' },
  { key: 'source_entity_type', label: 'Source entity type', source: 'response' },
  { key: 'source_entity_id', label: 'Source entity ID', source: 'response' },
]

export function buildResponseExportColumns(
  schemas: readonly FormSchemaV1[],
): ResponseExportColumn[] {
  const columns: ResponseExportColumn[] = [...RESPONSE_EXPORT_BASE_COLUMNS]
  const seen = new Set(columns.map((column) => column.key))
  for (const schema of schemas) {
    for (const section of schema.sections) {
      const sectionLabel = sectionTitle(section)
      if (section.repeating) {
        const key = `section:${section.id}`
        if (!seen.has(key)) {
          seen.add(key)
          columns.push({
            key,
            label: `${sectionLabel} rows`,
            description: 'Repeating section rows as JSON',
            source: 'section',
            sectionId: section.id,
          })
        }
        continue
      }

      for (const field of section.fields) {
        if (!isDataField(field)) continue
        const key = `field:${field.id}`
        if (seen.has(key)) continue
        seen.add(key)
        columns.push({
          key,
          label: `${sectionLabel} / ${fieldLabel(field)}`,
          description: field.type,
          source: 'field',
          fieldId: field.id,
          fieldType: field.type,
        })
      }
    }
  }
  return columns
}

export function valueForResponseExportColumn(
  column: ResponseExportColumn,
  ctx: ResponseExportContext,
): string | number | null | undefined {
  if (column.source === 'field') {
    return formatExportValue(column.fieldId ? ctx.values[column.fieldId] : undefined)
  }
  if (column.source === 'section') {
    return formatExportValue(column.sectionId ? ctx.values[column.sectionId] : undefined)
  }

  switch (column.key) {
    case 'response_id':
      return ctx.response.id
    case 'app':
      return ctx.template.name
    case 'category':
      return ctx.template.category ?? ''
    case 'kind':
      return ctx.template.kind
    case 'version':
      return ctx.version.version
    case 'status':
      return ctx.response.status
    case 'current_step':
      return ctx.response.currentStep ?? ''
    case 'site':
      return ctx.siteName ?? ''
    case 'subject':
      return ctx.subjectName ?? ''
    case 'submitted_by':
      return ctx.submittedByName ?? ''
    case 'created_at':
      return ctx.response.createdAt.toISOString()
    case 'updated_at':
      return ctx.response.updatedAt.toISOString()
    case 'submitted_at':
      return ctx.response.submittedAt?.toISOString() ?? ''
    case 'closed_at':
      return ctx.response.closedAt?.toISOString() ?? ''
    case 'locked':
      return ctx.response.locked ? 'Yes' : 'No'
    case 'compliance_score':
      return ctx.response.complianceScore ?? ''
    case 'compliance_status':
      return ctx.response.complianceStatus ?? ''
    case 'monitor_status':
      return ctx.response.monitorStatus ?? ''
    case 'source_entity_type':
      return ctx.response.sourceEntityType ?? ''
    case 'source_entity_id':
      return ctx.response.sourceEntityId ?? ''
    default:
      return ''
  }
}

function isDataField(field: FormField): boolean {
  return storesResponseValue(field)
}

function fieldLabel(field: FormField): string {
  return field.label?.en ?? Object.values(field.label ?? {})[0] ?? field.id
}

function sectionTitle(section: FormSection): string {
  return section.title?.en ?? Object.values(section.title ?? {})[0] ?? section.id
}

function formatExportValue(value: unknown): string | number | null | undefined {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map((item) => formatExportValue(item)).join('; ')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('answer' in record || 'comment' in record) {
      return [formatExportValue(record.answer), formatExportValue(record.comment)]
        .filter(Boolean)
        .join(' - ')
    }
    return JSON.stringify(value)
  }
  return String(value)
}
