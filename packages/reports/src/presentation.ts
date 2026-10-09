import type {
  ReportCustomQuery,
  ReportRunResult,
  ReportGroup,
  ReportEntityCatalog,
} from '@braedonsaunders/appkit-reports'

/** Optional document content owned by a saved tenant report, never by its source name. */
type ReportSection = {
  title: string
  fields: { label: string; value: string; uppercase?: boolean }[]
}
type PresentationColumn = {
  key: string
  label?: string
  rules?: { column: string; equals?: string; notEquals?: string; value: string }[]
  defaultValue?: string
}
export type ReportPresentation = {
  version: 1
  timezone?: string
  before?: ReportSection[]
  afterEachGroup?: ReportSection[]
  groupTitle?: string
  groupSubtitle?: string
  rowNumberLabel?: string
  columns?: PresentationColumn[]
  hiddenColumns?: string[]
  hideSummary?: boolean
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid report content.')
  return value as Record<string, unknown>
}
function text(value: unknown, limit = 4000): string {
  if (typeof value !== 'string' || value.length > limit)
    throw new Error('Invalid report content text.')
  return value
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error('Too many report content items.')
  return value
}
function optionalText(value: unknown, limit = 4000): string | undefined {
  return value === undefined ? undefined : text(value, limit)
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean')
    throw new Error('Invalid report content option.')
  return value as boolean | undefined
}
function sections(value: unknown): ReportSection[] | undefined {
  return value === undefined
    ? undefined
    : list(value, 12).map((item) => {
        const section = object(item)
        return {
          title: text(section.title),
          fields: list(section.fields, 12).map((item) => {
            const field = object(item)
            return {
              label: text(field.label, 200),
              value: text(field.value),
              uppercase: optionalBoolean(field.uppercase),
            }
          }),
        }
      })
}

export function reportPresentationFromLayout(layout: unknown): ReportPresentation | undefined {
  if (!layout || typeof layout !== 'object' || !('presentation' in layout)) return undefined
  const raw = (layout as { presentation?: unknown }).presentation
  if (raw === undefined || raw === null) return undefined
  const input = object(raw)
  if (input.version !== 1) throw new Error('Unsupported report content version.')
  const timezone = optionalText(input.timezone, 100)
  if (timezone) new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  return {
    version: 1,
    timezone,
    before: sections(input.before),
    afterEachGroup: sections(input.afterEachGroup),
    groupTitle: optionalText(input.groupTitle),
    groupSubtitle: optionalText(input.groupSubtitle),
    rowNumberLabel: optionalText(input.rowNumberLabel, 200),
    hideSummary: optionalBoolean(input.hideSummary),
    hiddenColumns:
      input.hiddenColumns === undefined
        ? undefined
        : list(input.hiddenColumns, 60).map((key) => text(key, 100)),
    columns:
      input.columns === undefined
        ? undefined
        : list(input.columns, 60).map((item) => {
            const column = object(item)
            const key = text(column.key, 100)
            if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error('Invalid report content column.')
            return {
              key,
              label: optionalText(column.label, 200),
              defaultValue: optionalText(column.defaultValue),
              rules:
                column.rules === undefined
                  ? undefined
                  : list(column.rules, 20).map((item) => {
                      const rule = object(item)
                      const equals = optionalText(rule.equals)
                      const notEquals = optionalText(rule.notEquals)
                      if ((equals === undefined) === (notEquals === undefined))
                        throw new Error('Choose one report content comparison.')
                      return {
                        column: text(rule.column, 100),
                        equals,
                        notEquals,
                        value: text(rule.value),
                      }
                    }),
            }
          }),
  }
}

const TOKEN = /\{\{([^{}]+)\}\}/g
const TENANT_FIELDS = new Set(['name', 'companyName', 'companyAddress'])

/** All referenced data must be explicitly selected by the authorized query. */
export function validateReportPresentation(
  presentation: ReportPresentation | undefined,
  query: ReportCustomQuery,
  catalog: ReportEntityCatalog,
): void {
  if (!presentation) return
  if ((query.mode ?? 'rows') !== 'rows')
    throw new Error('Document content requires a detail rows report.')
  const entity = catalog.entities.find((entity) => entity.key === query.entity)
  const selected = new Set(query.columns)
  const requireColumn = (key: string) => {
    if (
      !selected.has(key) ||
      !entity?.columns.some((column) => column.key === key && !column.hidden)
    )
      throw new Error(`Report content requires the selected column "${key}".`)
  }
  const validateText = (value: string) => {
    for (const match of value.matchAll(TOKEN)) {
      const token = match[1]!
      if (token === 'group.title' || token === 'date.month' || token === 'date.year') continue
      if (token.startsWith('tenant.') && TENANT_FIELDS.has(token.slice(7))) continue
      if (token.startsWith('count.')) {
        const column = entity?.columns.find((column) => column.key === token.slice(6))
        if (!column) throw new Error(`Unknown report count field "${token.slice(6)}".`)
        if (column.kind !== 'uuid') requireColumn(column.key)
        continue
      }
      if (token.startsWith('value.')) {
        requireColumn(token.slice(6))
        continue
      }
      throw new Error(`Unknown report content field "${token}".`)
    }
    if (value.replace(TOKEN, '').includes('{{') || value.replace(TOKEN, '').includes('}}'))
      throw new Error('Invalid report content field.')
  }
  const templates = [
    presentation.groupTitle,
    presentation.groupSubtitle,
    ...[...(presentation.before ?? []), ...(presentation.afterEachGroup ?? [])].flatMap(
      (section) => [section.title, ...section.fields.map((field) => field.value)],
    ),
  ]
  templates.forEach((value) => {
    if (value !== undefined) validateText(value)
  })
  const keys = new Set<string>()
  for (const column of presentation.columns ?? []) {
    if (keys.has(column.key)) throw new Error('Duplicate report content column.')
    keys.add(column.key)
    if (column.rules) column.rules.forEach((rule) => requireColumn(rule.column))
    else requireColumn(column.key)
  }
  if (presentation.rowNumberLabel !== undefined && keys.has('row_number'))
    throw new Error('Report row numbering conflicts with a content column.')
}

/** Safe plain text result groups: native screen, PDF, CSV and schedules share the same output. */
export function presentReportResult(
  result: ReportRunResult,
  presentation: ReportPresentation,
  tenant: { name: string; companyName: string; companyAddress: string },
  printedAt = new Date(),
  counts?: ReadonlyMap<string, Readonly<Record<string, number>>>,
): ReportRunResult {
  const timezone = presentation.timezone ?? 'UTC'
  const date = {
    month: new Intl.DateTimeFormat('en', { timeZone: timezone, month: '2-digit' }).format(
      printedAt,
    ),
    year: new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric' }).format(printedAt),
  }
  const renderText = (template: string, group?: ReportGroup) =>
    template.replace(TOKEN, (_, token: string) => {
      if (token.startsWith('tenant.')) return tenant[token.slice(7) as keyof typeof tenant]
      if (token === 'group.title') return group?.title ?? ''
      if (token.startsWith('date.')) return date[token.slice(5) as keyof typeof date]
      const key = token.slice(6)
      if (token.startsWith('count.') && group && counts?.get(group.title)?.[key] !== undefined)
        return String(counts.get(group.title)![key])
      if (token.startsWith('count.'))
        return String(
          new Set(
            group?.rows
              .map((row) => row[key])
              .filter((value) => value !== null && value !== undefined && value !== ''),
          ).size,
        )
      const values = [
        ...new Set(
          group?.rows
            .map((row) => row[key])
            .filter((value) => value !== null && value !== undefined && value !== '')
            .map(String),
        ),
      ]
      return values.join(', ')
    })
  const renderSections = (sections: ReportSection[], group?: ReportGroup): ReportGroup[] =>
    sections.map((section) => ({
      kind: 'section',
      title: renderText(section.title, group),
      columns: section.fields.map((field, index) => ({
        key: `field_${index}`,
        label: field.label,
        semanticType: 'category',
      })),
      rows: [
        Object.fromEntries(
          section.fields.map((field, index) => {
            const value = renderText(field.value, group)
            return [`field_${index}`, field.uppercase ? value.toUpperCase() : value]
          }),
        ),
      ],
    }))
  return {
    ...result,
    summary: presentation.hideSummary ? [] : result.summary,
    groups: [
      ...renderSections(presentation.before ?? []),
      ...result.groups.flatMap((group) => {
        const configured = new Map(
          (presentation.columns ?? []).map((column) => [column.key, column]),
        )
        const hidden = new Set(presentation.hiddenColumns ?? [])
        const columns = group.columns
          .filter((column) => !hidden.has(column.key))
          .map((column) => ({
            ...column,
            label: configured.get(column.key)?.label ?? column.label,
          }))
        for (const column of presentation.columns ?? []) {
          if (
            !column.rules ||
            columns.some((existing) => existing.key === column.key) ||
            hidden.has(column.key)
          )
            continue
          columns.push({
            key: column.key,
            label: column.label ?? column.key,
            semanticType: 'category',
          })
        }
        return [
          {
            ...group,
            title:
              presentation.groupTitle === undefined
                ? group.title
                : renderText(presentation.groupTitle, group),
            subtitle:
              presentation.groupSubtitle === undefined
                ? group.subtitle
                : renderText(presentation.groupSubtitle, group),
            columns:
              presentation.rowNumberLabel === undefined
                ? columns
                : [
                    {
                      key: 'row_number',
                      label: presentation.rowNumberLabel,
                      semanticType: 'number' as const,
                    },
                    ...columns,
                  ],
            rows: group.rows.map((row, index) => {
              const values = Object.fromEntries(
                (presentation.columns ?? [])
                  .filter((column) => column.rules)
                  .map((column) => {
                    const rule = column.rules!.find((rule) => {
                      const value = String(row[rule.column] ?? '').toLowerCase()
                      return rule.equals !== undefined
                        ? value === rule.equals.toLowerCase()
                        : value !== rule.notEquals!.toLowerCase()
                    })
                    return [column.key, rule?.value ?? column.defaultValue ?? '']
                  }),
              )
              return {
                ...row,
                ...values,
                ...(presentation.rowNumberLabel === undefined ? {} : { row_number: index + 1 }),
              }
            }),
          },
          ...renderSections(presentation.afterEachGroup ?? [], group),
        ]
      }),
    ],
  }
}
