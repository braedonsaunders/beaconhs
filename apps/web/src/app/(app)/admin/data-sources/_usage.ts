import type { FormField, FormSchemaV1, I18nString } from '@beaconhs/forms-core'

type DataSourceFieldUsage = {
  fieldId: string
  fieldLabel: string
  fieldType: string
}

type DataSourceAppUsage = {
  templateId: string
  templateName: string
  fields: DataSourceFieldUsage[]
}

type VersionRow = {
  templateId: string
  templateName: string
  version: number
  schema: FormSchemaV1
}

function labelText(label: I18nString | undefined, fallback: string): string {
  if (!label) return fallback
  return label.en ?? Object.values(label)[0] ?? fallback
}

function fieldsInSchema(schema: FormSchemaV1): FormField[] {
  return (schema.sections ?? []).flatMap((section) => section.fields ?? [])
}

export function collectDataSourceUsage(
  versionRows: VersionRow[],
): Map<string, DataSourceAppUsage[]> {
  const latestByTemplate = new Map<string, VersionRow>()
  for (const row of versionRows) {
    const current = latestByTemplate.get(row.templateId)
    if (!current || row.version > current.version) latestByTemplate.set(row.templateId, row)
  }

  const usage = new Map<string, DataSourceAppUsage[]>()
  for (const row of latestByTemplate.values()) {
    const fieldsBySource = new Map<string, DataSourceFieldUsage[]>()
    for (const field of fieldsInSchema(row.schema)) {
      const sourceKey = field.binding?.sourceKey
      if (!sourceKey) continue
      const fields = fieldsBySource.get(sourceKey) ?? []
      fields.push({
        fieldId: field.id,
        fieldLabel: labelText(field.label, field.id),
        fieldType: field.type,
      })
      fieldsBySource.set(sourceKey, fields)
    }
    for (const [sourceKey, fields] of fieldsBySource) {
      const apps = usage.get(sourceKey) ?? []
      apps.push({
        templateId: row.templateId,
        templateName: row.templateName,
        fields,
      })
      usage.set(sourceKey, apps)
    }
  }

  return usage
}
