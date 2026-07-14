import type { FormField, FormSchemaV1, I18nString } from '@beaconhs/forms-core'
import { DEFAULT_LOCALE, localizeText, type AppLocale } from '@beaconhs/i18n'

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

function labelText(
  label: I18nString | undefined,
  fallback: string,
  locale: AppLocale,
  defaultLocale: AppLocale,
): string {
  return localizeText(label, locale, fallback, defaultLocale)
}

function fieldsInSchema(schema: FormSchemaV1): FormField[] {
  return (schema.sections ?? []).flatMap((section) => section.fields ?? [])
}

export function collectDataSourceUsage(
  versionRows: VersionRow[],
  locale: AppLocale = DEFAULT_LOCALE,
  defaultLocale: AppLocale = DEFAULT_LOCALE,
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
        fieldLabel: labelText(field.label, field.id, locale, defaultLocale),
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
