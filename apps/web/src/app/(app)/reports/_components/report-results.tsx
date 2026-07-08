// Server-renderable result blocks shared by the report viewer and the studio
// preview: summary stat cards and a table per group with a per-group row cap.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@beaconhs/ui'
import { Inbox } from 'lucide-react'
import type { ReportRunResult } from '@beaconhs/reports'
import { PaginatedReportTable } from './paginated-report-table.client'

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

export function ReportGroupTables({ groups }: { groups: ReportRunResult['groups'] }) {
  if (!groups.length) return null
  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
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
              <PaginatedReportTable columns={g.columns} rows={g.rows} />
            )}
          </CardContent>
        </Card>
      ))}
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
