'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        <GeneratedValue
          value={entities.map((entity) => (
            <ListCard
              key={entity.key}
              onClick={() => openSource(entity.key)}
              reference={entity.ownerLabel}
              status={<SensitivityBadge sensitivity={entity.sensitivity} />}
              title={tGeneratedValue(entity.label)}
              meta={`${entity.defaultScope} / ${entity.columns.length} columns`}
              footer={
                <>
                  <GeneratedValue
                    value={entity.filterSummary.slice(0, 3).map((filter) => (
                      <Badge key={filter} variant="outline">
                        <GeneratedValue value={filter} />
                      </Badge>
                    ))}
                  />
                  <GeneratedValue
                    value={
                      entity.filterSummary.length > 3 ? (
                        <Badge variant="secondary">
                          +<GeneratedValue value={entity.filterSummary.length - 3} />
                        </Badge>
                      ) : null
                    }
                  />
                </>
              }
            />
          ))}
        />
      </MobileCardList>

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <GeneratedText id="m_1e51e17fccd721" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_065b964e065bf7" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_1f10a46fc1db73" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_1f9dc6f1f797f7" />
              </TableHead>
              <TableHead>
                <GeneratedText id="m_12de0a8fa81d16" />
              </TableHead>
              <TableHead className="text-right">
                <GeneratedText id="m_01edcd3d04ad91" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <GeneratedValue
              value={entities.map((entity) => (
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
                      <GeneratedValue value={entity.label} />
                    </div>
                    <div className="mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedValue value={entity.description} />
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                    <GeneratedValue value={entity.ownerLabel} />
                  </TableCell>
                  <TableCell className="min-w-48">
                    <div className="text-sm text-slate-700 dark:text-slate-200">
                      <GeneratedValue value={entity.defaultScope} />
                    </div>
                    <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedValue value={entity.rowLimit} />
                    </div>
                  </TableCell>
                  <TableCell className="min-w-56">
                    <div className="flex flex-wrap gap-1.5">
                      <GeneratedValue
                        value={entity.filterSummary.slice(0, 4).map((filter) => (
                          <span
                            key={filter}
                            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                          >
                            <GeneratedValue value={filter} />
                          </span>
                        ))}
                      />
                      <GeneratedValue
                        value={
                          entity.filterSummary.length > 4 ? (
                            <span className="text-xs text-slate-400">
                              +<GeneratedValue value={entity.filterSummary.length - 4} />
                            </span>
                          ) : null
                        }
                      />
                      <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/60 dark:text-teal-300">
                        <GeneratedValue value={entity.columns.length} />{' '}
                        <GeneratedText id="m_1212b96e221372" />
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SensitivityBadge sensitivity={entity.sensitivity} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        aria-label={tGenerated('m_07f6f328b6cf6a', { value0: entity.label })}
                      >
                        <Link
                          href={entity.sourceHref as any}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </Button>
                      {/* Plain <a>: <Link> prefetches the /export.csv route handler,
                        which runs the export query and records a phantom audit
                        entry (see 7170384). Anchors don't prefetch. */}
                      <Button asChild size="sm">
                        <a href={entity.csvHref} onClick={(event) => event.stopPropagation()}>
                          <Download size={14} className="mr-1.5" />
                          <GeneratedText id="m_13bc18467bfb44" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            />
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
      <GeneratedValue value={sensitivity} />
    </Badge>
  )
}
