import {
  reportColumnExpression,
  type CompiledCustomReport,
  type ReportEntityCatalog,
  type ReportRunResult,
} from '@braedonsaunders/appkit-reports'
import type { ReportPresentation } from './presentation'

/** Internal aggregate inputs are read under the exact same row/tenant scope and
 * limit as the report. Their identifiers are stripped before any result leaves
 * the server; neither the builder nor exports expose an internal ID column. */
export function reportCountProjection(
  compiled: CompiledCustomReport,
  entityKey: string,
  catalog: ReportEntityCatalog,
  presentation: ReportPresentation | undefined,
): { compiled: CompiledCustomReport; fields: { key: string; alias: string }[] } {
  if (!presentation) return { compiled, fields: [] }
  const templates = [
    presentation.groupTitle,
    presentation.groupSubtitle,
    ...[...(presentation.before ?? []), ...(presentation.afterEachGroup ?? [])].flatMap(
      (section) => [section.title, ...section.fields.map((field) => field.value)],
    ),
  ]
  const keys = [
    ...new Set(
      templates.flatMap((text) =>
        [...(text ?? '').matchAll(/\{\{count\.([^{}]+)\}\}/g)].map((match) => match[1]!),
      ),
    ),
  ]
  if (!keys.length) return { compiled, fields: [] }
  const entity = catalog.entities.find((entity) => entity.key === entityKey)
  if (!entity || compiled.mode !== 'rows' || !compiled.sql.startsWith('SELECT '))
    throw new Error('Report counts require a detail rows source.')
  const fields = keys.map((key, index) => ({ key, alias: `__report_count_${index}` }))
  const expressions = fields.map(({ key, alias }) => {
    const expression = reportColumnExpression(entity, key)
    if (!expression) throw new Error('Report count field is unavailable.')
    return `${expression} AS "${alias}"`
  })
  return {
    compiled: {
      ...compiled,
      sql: compiled.sql.replace(/^SELECT /, `SELECT ${expressions.join(', ')}, `),
    },
    fields,
  }
}

export function extractReportCounts(
  result: ReportRunResult,
  fields: readonly { key: string; alias: string }[],
): { result: ReportRunResult; counts: ReadonlyMap<string, Readonly<Record<string, number>>> } {
  const counts = new Map<string, Record<string, number>>()
  const groups = result.groups.map((group) => {
    counts.set(
      group.title,
      Object.fromEntries(
        fields.map(({ key, alias }) => [
          key,
          new Set(
            group.rows
              .map((row) => row[alias])
              .filter((value) => value !== null && value !== undefined && value !== ''),
          ).size,
        ]),
      ),
    )
    return {
      ...group,
      rows: group.rows.map((row) => {
        const visible = { ...row }
        for (const field of fields) delete visible[field.alias]
        return visible
      }),
    }
  })
  return { result: { ...result, groups }, counts }
}
