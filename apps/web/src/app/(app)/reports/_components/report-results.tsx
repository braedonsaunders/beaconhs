// Server-renderable result blocks shared by the report viewer and the studio
// preview: summary stat cards, the charts row (client ECharts inside), and a
// table per group with a per-group row cap.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { Inbox } from 'lucide-react'
import type { ReportRunResult } from '@beaconhs/reports'
import { ReportChart } from './report-chart'

const GROUP_ROW_CAP = 100

export function ReportSummaryCards({ summary }: { summary: ReportRunResult['summary'] }) {
  if (!summary.length) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {summary.map((s) => (
        <Card key={s.label}>
          <CardContent className="p-4">
            <div className="truncate text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
              {s.label}
            </div>
            <div className="mt-1 truncate text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {s.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function ReportCharts({
  charts,
  height,
}: {
  charts: ReportRunResult['charts']
  height?: number
}) {
  if (!charts.length) return null
  return (
    <div className={charts.length > 1 ? 'grid gap-4 lg:grid-cols-2' : ''}>
      {charts.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle className="text-sm">{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportChart spec={c} height={height ?? 280} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function ReportGroupTables({
  groups,
  rowCap = GROUP_ROW_CAP,
  capNote = 'Export to view all rows.',
}: {
  groups: ReportRunResult['groups']
  rowCap?: number
  capNote?: string
}) {
  if (!groups.length) return null
  return (
    <div className="space-y-4">
      {groups.map((g, i) => {
        const shown = g.rows.slice(0, rowCap)
        const hidden = g.rows.length - shown.length
        return (
          <Card key={`${g.title}-${i}`}>
            <CardHeader>
              <CardTitle className="text-sm">
                {g.title}
                {g.subtitle ? (
                  <span className="ml-2 font-normal text-slate-400">{g.subtitle}</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {g.isEmpty || g.rows.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="No data"
                  description="No records for the selected range."
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {g.columns.map((c) => (
                            <TableHead key={c}>{c}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((row, ri) => (
                          <TableRow key={ri}>
                            {row.map((cell, ci) => (
                              <TableCell
                                key={ci}
                                className="max-w-[28rem] truncate text-slate-600 dark:text-slate-300"
                              >
                                {cell === null || typeof cell === 'undefined' || cell === '' ? (
                                  <span className="text-slate-300 dark:text-slate-600">—</span>
                                ) : (
                                  String(cell)
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {hidden > 0 ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Showing {shown.length} of {g.rows.length} rows. {capNote}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function ReportRunError({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>This report failed to run</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}
