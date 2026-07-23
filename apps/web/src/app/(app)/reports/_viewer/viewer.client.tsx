'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Download, Filter, Pencil, RotateCcw } from 'lucide-react'
import {
  reportEntity,
  type ReportEntityCatalog,
  type ReportLayout,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@beaconhs/reports'
import { ReportFilterTree, ReportResultView } from '@beaconhs/reports/react'
import { Button, Select } from '@beaconhs/ui'
import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { runReportWithControls } from './actions'

const EMPTY_FILTERS: ReportRuleGroup = { combinator: 'and', rules: [] }

export function BeaconReportViewer({
  definition,
  catalog,
  organization,
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
      filters?: ReportRuleGroup | null
      groupBy?: string | null
    }
    layout: ReportLayout
  }
  catalog: ReportEntityCatalog
  organization: string
  initialResult: ReportRunResult
  initialError: string | null
  canBuild: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const savedFilters = definition.query.filters ?? EMPTY_FILTERS
  const savedGroupBy = definition.query.groupBy ?? ''
  const [filters, setFilters] = useState<ReportRuleGroup>(() => structuredClone(savedFilters))
  const [groupBy, setGroupBy] = useState(savedGroupBy)
  const [result, setResult] = useState(initialResult)
  const [error, setError] = useState(initialError)
  const [pending, startTransition] = useTransition()
  const entity = reportEntity(catalog, definition.query.entity)
  const activeFilters = filters.rules.length ? filters : null
  const exportQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (activeFilters) params.set('filters', JSON.stringify(activeFilters))
    if (groupBy) params.set('groupBy', groupBy)
    return params
  }, [activeFilters, groupBy])

  const run = () => {
    startTransition(async () => {
      const next = await runReportWithControls(definition.id, {
        filters: activeFilters,
        groupBy: groupBy || null,
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
  }
  const href = (format: 'csv' | 'xlsx' | 'pdf') => {
    const params = new URLSearchParams(exportQuery)
    params.set('format', format)
    return `/reports/definitions/${definition.id}/export?${params}`
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={href('csv')}>
            <Download size={14} />
            <GeneratedText id="m_13bc18467bfb44" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={href('xlsx')}>
            <Download size={14} />
            <GeneratedText id="m_0c81eece17490f" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={href('pdf')}>
            <Download size={14} />
            <GeneratedText id="m_1a2b2ed6729166" />
          </Link>
        </Button>
        {canBuild ? (
          <Button asChild>
            <Link href={`/reports/definitions/${definition.id}/edit`}>
              <Pencil size={14} />
              <GeneratedText id="m_186e85e2d4fd61" />
            </Link>
          </Button>
        ) : null}
      </div>

      {entity ? (
        <details className="border-border bg-surface rounded-lg border" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
            <Filter size={15} />
            <GeneratedText id="m_128cb01c068b95" />
          </summary>
          <div className="border-border space-y-4 border-t p-4">
            <div className="max-w-sm space-y-1">
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
                {entity.columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </Select>
              <p className="text-fg-muted text-xs">
                <GeneratedText id="m_176a68ad690d1e" />
              </p>
            </div>
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
        </details>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : (
        <ReportResultView
          organization={organization}
          title={definition.name}
          description={definition.description ?? undefined}
          layout={definition.layout}
          result={result}
        />
      )}
    </div>
  )
}
