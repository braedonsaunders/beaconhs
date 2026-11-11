'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Download, Filter, Pencil, RotateCcw } from 'lucide-react'
import { DownloadLink } from '@/components/download-link'
import {
  reportEntity,
  type ReportCustomQuery,
  type ReportEntityCatalog,
  type ReportLayout,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@beaconhs/reports'
import { ReportFilterTree, ReportResultView } from '@beaconhs/reports/react'
import { Button, PageHeader, Select } from '@beaconhs/ui'
import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { runReportWithControls } from './actions'

const EMPTY_FILTERS: ReportRuleGroup = { combinator: 'and', rules: [] }

function resolveInitialViewerSort(query: Pick<ReportCustomQuery, 'groupBy' | 'sort' | 'sorts'>): {
  column: string
  direction: 'asc' | 'desc'
} {
  const configured = query.sorts?.length ? query.sorts : query.sort ? [query.sort] : []
  const withinGroup = query.groupBy
    ? configured.find((entry) => entry.column !== query.groupBy)
    : undefined
  const picked = withinGroup ?? configured[0]
  return {
    column: picked?.column ?? '',
    direction: picked?.direction === 'desc' ? 'desc' : 'asc',
  }
}

export function BeaconReportViewer({
  definition,
  catalog,
  organization,
  logoUrl,
  primaryColor,
  description,
  initialResult,
  initialError,
  canBuild,
}: {
  definition: {
    id: string
    name: string
    description: string | null
    query: {
      entity: string
      mode?: 'rows' | 'summarize'
      filters?: ReportRuleGroup | null
      groupBy?: string | null
      sort?: { column: string; direction: 'asc' | 'desc' } | null
      sorts?: { column: string; direction: 'asc' | 'desc' }[] | null
    }
    layout: ReportLayout
  }
  catalog: ReportEntityCatalog
  organization: string
  logoUrl: string | null
  primaryColor: string | null
  description: string
  initialResult: ReportRunResult
  initialError: string | null
  canBuild: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const savedFilters = definition.query.filters ?? EMPTY_FILTERS
  const savedGroupBy = definition.query.groupBy ?? ''
  const savedSort = resolveInitialViewerSort(definition.query)
  const isRowReport = (definition.query.mode ?? 'rows') === 'rows'
  const [filters, setFilters] = useState<ReportRuleGroup>(() => structuredClone(savedFilters))
  const [groupBy, setGroupBy] = useState(savedGroupBy)
  const [sortColumn, setSortColumn] = useState(savedSort.column)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(savedSort.direction)
  const [result, setResult] = useState(initialResult)
  const [error, setError] = useState(initialError)
  const [pending, startTransition] = useTransition()
  const entity = reportEntity(catalog, definition.query.entity)
  const visibleColumns = useMemo(
    () => (entity ? entity.columns.filter((column) => !column.hidden) : []),
    [entity],
  )
  const activeFilters = filters.rules.length ? filters : null
  const activeSort = useMemo(
    () => (isRowReport && sortColumn ? { column: sortColumn, direction: sortDirection } : null),
    [isRowReport, sortColumn, sortDirection],
  )
  const exportQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set('filters', JSON.stringify(activeFilters))
    params.set('groupBy', groupBy)
    if (activeSort) {
      params.set('sortColumn', activeSort.column)
      params.set('sortDirection', activeSort.direction)
    }
    return params
  }, [activeFilters, activeSort, groupBy])

  const run = () => {
    startTransition(async () => {
      const next = await runReportWithControls(definition.id, {
        filters: activeFilters,
        groupBy: groupBy || null,
        sort: activeSort,
      })
      if (!next.ok) {
        setError(next.error)
        return
      }
      setError(null)
      setResult(next.result)
    })
  }
  const reset = () => {
    setFilters(structuredClone(savedFilters))
    setGroupBy(savedGroupBy)
    setSortColumn(savedSort.column)
    setSortDirection(savedSort.direction)
  }
  const href = (format: 'csv' | 'xlsx' | 'pdf') => {
    const params = new URLSearchParams(exportQuery)
    params.set('format', format)
    return `/reports/definitions/${definition.id}/export?${params}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={definition.name}
        description={description}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <DownloadLink href={href('csv')}>
                <Download size={14} />
                <GeneratedText id="m_13bc18467bfb44" />
              </DownloadLink>
            </Button>
            <Button asChild variant="outline" size="sm">
              <DownloadLink href={href('xlsx')}>
                <Download size={14} />
                <GeneratedText id="m_0c81eece17490f" />
              </DownloadLink>
            </Button>
            <Button asChild variant="outline" size="sm">
              <DownloadLink href={href('pdf')}>
                <Download size={14} />
                <GeneratedText id="m_1a2b2ed6729166" />
              </DownloadLink>
            </Button>
            {canBuild ? (
              <Button asChild size="sm">
                <Link href={`/reports/definitions/${definition.id}/edit`}>
                  <Pencil size={14} />
                  <GeneratedText id="m_186e85e2d4fd61" />
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {entity ? (
          <section aria-labelledby="report-run-controls" className="min-w-0 lg:col-span-1">
            <div className="border-border bg-surface space-y-3 rounded-lg border p-3 sm:p-4 lg:sticky lg:top-0">
              <h2
                id="report-run-controls"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Filter size={15} />
                <GeneratedText id="m_128cb01c068b95" />
              </h2>
              <div className="space-y-1">
                <label htmlFor="report-runtime-group" className="text-sm font-medium">
                  <GeneratedText id="m_1063fd45cc34b2" />
                </label>
                <Select
                  id="report-runtime-group"
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value)}
                >
                  <option value="">
                    <GeneratedText id="m_023e5c19efd4cc" />
                  </option>
                  {visibleColumns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </Select>
                <p className="text-fg-muted text-xs">
                  <GeneratedText id="m_176a68ad690d1e" />
                </p>
              </div>
              {isRowReport ? (
                <div className="space-y-1">
                  <label htmlFor="report-runtime-sort" className="text-sm font-medium">
                    <GeneratedText id="m_16242051249005" />
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Select
                        id="report-runtime-sort"
                        value={sortColumn}
                        onChange={(event) => setSortColumn(event.target.value)}
                      >
                        <option value="">
                          <GeneratedText id="m_0be21d970819f1" />
                        </option>
                        {visibleColumns.map((column) => (
                          <option key={column.key} value={column.key}>
                            {column.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Select
                      aria-label={tGenerated('m_1a2f5ca545dec7')}
                      value={sortDirection}
                      disabled={!sortColumn}
                      onChange={(event) =>
                        setSortDirection(event.target.value === 'desc' ? 'desc' : 'asc')
                      }
                    >
                      <option value="asc">
                        <GeneratedText id="m_0027c5891082cf" />
                      </option>
                      <option value="desc">
                        <GeneratedText id="m_14a3ccc633a056" />
                      </option>
                    </Select>
                  </div>
                  <p className="text-fg-muted text-xs">
                    <GeneratedText id="m_017701ff251fc3" />
                  </p>
                </div>
              ) : null}
              <ReportFilterTree entity={entity} group={filters} onChange={setFilters} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={run} disabled={pending}>
                  {pending ? tGenerated('m_1f2c7907712729') : tGenerated('m_1df37ea02bdc43')}
                </Button>
                <Button type="button" variant="outline" onClick={reset} disabled={pending}>
                  <RotateCcw size={14} />
                  <GeneratedText id="m_1f8b8825b90200" />
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        <div className={entity ? 'min-w-0 lg:col-span-2' : 'min-w-0 lg:col-span-3'}>
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            >
              {error}
            </div>
          ) : (
            <div className="space-y-3">
              {result.truncated ? (
                <div
                  role="status"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <GeneratedText
                    id="m_002b68d8bfe1f1"
                    values={{ value0: result.rowCount.toLocaleString() }}
                  />
                </div>
              ) : null}
              <ReportResultView
                organization={organization}
                logoUrl={logoUrl}
                primaryColor={primaryColor}
                title={definition.name}
                description={definition.description ?? undefined}
                layout={definition.layout}
                result={result}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
