'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Download } from 'lucide-react'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@beaconhs/ui'
import { ListCard, MobileCardList } from '@/components/list-card'
import { mergeHref } from '@/lib/list-params'
import type { ExportEntity } from './_entities'

export function ExportSourcesTable({
  entities,
  currentParams,
  selectedKey,
}: {
  entities: ExportEntity[]
  currentParams: Record<string, string | string[] | undefined>
  selectedKey?: string
}) {
  const router = useRouter()

  function sourceHref(key: string): string {
    return mergeHref('/admin/export', currentParams, { source: key })
  }

  function openSource(key: string) {
    router.push(sourceHref(key))
  }

  return (
    <>
      <MobileCardList>
        {entities.map((entity) => (
          <ListCard
            key={entity.key}
            onClick={() => openSource(entity.key)}
            reference={entity.ownerLabel}
            status={<SensitivityBadge sensitivity={entity.sensitivity} />}
            title={entity.label}
            meta={`${entity.defaultScope} / ${entity.columns.length} columns`}
            footer={
              <>
                {entity.filterSummary.slice(0, 3).map((filter) => (
                  <Badge key={filter} variant="outline">
                    {filter}
                  </Badge>
                ))}
                {entity.filterSummary.length > 3 ? (
                  <Badge variant="secondary">+{entity.filterSummary.length - 3}</Badge>
                ) : null}
              </>
            }
          />
        ))}
      </MobileCardList>

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data source</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Filters</TableHead>
              <TableHead>Sensitivity</TableHead>
              <TableHead className="text-right">Export</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.map((entity) => (
              <TableRow
                key={entity.key}
                onClick={() => openSource(entity.key)}
                className={cn(
                  'cursor-pointer',
                  selectedKey === entity.key &&
                    'bg-teal-50/70 hover:bg-teal-50/70 dark:bg-teal-500/10 dark:hover:bg-teal-500/10',
                )}
              >
                <TableCell className="min-w-72">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {entity.label}
                  </div>
                  <div className="mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">
                    {entity.description}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                  {entity.ownerLabel}
                </TableCell>
                <TableCell className="min-w-48">
                  <div className="text-sm text-slate-700 dark:text-slate-200">
                    {entity.defaultScope}
                  </div>
                  <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    {entity.rowLimit}
                  </div>
                </TableCell>
                <TableCell className="min-w-56">
                  <div className="flex flex-wrap gap-1.5">
                    {entity.filterSummary.slice(0, 4).map((filter) => (
                      <span
                        key={filter}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                      >
                        {filter}
                      </span>
                    ))}
                    {entity.filterSummary.length > 4 ? (
                      <span className="text-xs text-slate-400">
                        +{entity.filterSummary.length - 4}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/60 dark:text-teal-300">
                      {entity.columns.length} columns
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <SensitivityBadge sensitivity={entity.sensitivity} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button asChild variant="outline" size="sm" aria-label={`Open ${entity.label}`}>
                      <Link
                        href={entity.sourceHref as any}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ArrowUpRight size={14} />
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link
                        href={entity.csvHref as any}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Download size={14} className="mr-1.5" />
                        CSV
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function SensitivityBadge({ sensitivity }: { sensitivity: ExportEntity['sensitivity'] }) {
  return (
    <Badge
      variant={
        sensitivity === 'Restricted'
          ? 'destructive'
          : sensitivity === 'Sensitive'
            ? 'warning'
            : 'secondary'
      }
    >
      {sensitivity}
    </Badge>
  )
}
