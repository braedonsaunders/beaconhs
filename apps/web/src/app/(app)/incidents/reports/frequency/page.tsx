// /incidents/reports/frequency — TRIR (total recordable incident rate)
// per month using the OSHA formula:
//   TRIR = (recordable count × 200 000) / hours worked
//
// Hours come from incident_hours_periods.  Recordable count is sourced
// from incidents whose linked classification has isRecordable=1 (with
// severity heuristic fallback for un-classified rows).

import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../../_sub-nav'
import { IncidentReportsSubNav } from '../_sub-nav'
import {
  defaultRangeYmd,
  fmtRate,
  hoursInRange,
  monthBuckets,
  recordableCountInRange,
  trir,
  OSHA_MULTIPLIER,
} from '../_lib'
import { pickString } from '@/lib/list-params'

export const metadata = { title: 'Frequency rate' }
export const dynamic = 'force-dynamic'

export default async function FrequencyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const fallback = defaultRangeYmd()
  const startYmd = pickString(sp.start) ?? fallback.start
  const endYmd = pickString(sp.end) ?? fallback.end

  await requireRequestContext()
  const ctx = await requireRequestContext()
  const buckets = monthBuckets(startYmd, endYmd)

  // Compute everything in parallel.
  const overallHours = await hoursInRange(ctx, startYmd, endYmd)
  const overallRecordable = await recordableCountInRange(ctx, startYmd, endYmd)
  const overallTrir = trir(overallRecordable, overallHours.totalHours)

  const rows = await Promise.all(
    buckets.map(async (b) => {
      const h = await hoursInRange(ctx, b.start, b.end)
      const c = await recordableCountInRange(ctx, b.start, b.end)
      return {
        ...b,
        hours: h.totalHours,
        recordable: c,
        rate: trir(c, h.totalHours),
      }
    }),
  )

  const maxRate = rows.reduce(
    (m, r) => (r.rate != null && r.rate > m ? r.rate : m),
    0,
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Frequency rate (TRIR)"
            description="Total recordable incident rate per month. OSHA formula: (recordable × 200 000) / hours worked."
            actions={
              <Link href="/incidents/hours">
                <Button variant="outline">Manage hours</Button>
              </Link>
            }
          />
          <IncidentsSubNav active="reports" />
          <IncidentReportsSubNav active="frequency" />
          <RangeForm startYmd={startYmd} endYmd={endYmd} />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Per-month breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">Select a date range to see results.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Recordable</TableHead>
                    <TableHead className="text-right">TRIR</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium text-slate-900">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {r.hours > 0 ? r.hours.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.recordable}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.rate == null ? (
                          <span className="text-xs text-slate-400">no hours</span>
                        ) : (
                          <RateBadge rate={r.rate} />
                        )}
                      </TableCell>
                      <TableCell>
                        {r.rate != null && maxRate > 0 ? (
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full bg-teal-600"
                              style={{ width: `${Math.min(100, (r.rate / maxRate) * 100)}%` }}
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Range total</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <KpiRow
                label="Hours worked"
                value={overallHours.totalHours.toLocaleString()}
                sub={`${overallHours.periodCount} period${overallHours.periodCount === 1 ? '' : 's'} captured`}
              />
              <KpiRow
                label="Recordable incidents"
                value={overallRecordable.toLocaleString()}
              />
              <KpiRow
                label="TRIR (range)"
                value={fmtRate(overallTrir)}
                sub="Industry benchmark ≈ 3.0"
              />
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="font-mono">
                  {overallRecordable} × {OSHA_MULTIPLIER.toLocaleString()} /
                  {overallHours.totalHours.toLocaleString()} ={' '}
                  <strong>{fmtRate(overallTrir)}</strong>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Heads up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                A month is shown as <em>no hours</em> when no incident_hours_periods row covers
                that window — the rate is mathematically undefined.
              </p>
              <p>
                "Recordable" is a property of the linked classification. Toggle the
                <em> recordable </em>
                flag on a classification node to include/exclude that category from the rollup.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </ListPageLayout>
  )
}

function RangeForm({ startYmd, endYmd }: { startYmd: string; endYmd: string }) {
  return (
    <form
      action="/incidents/reports/frequency"
      method="GET"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="start">Start</Label>
        <Input id="start" name="start" type="date" defaultValue={startYmd} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="end">End</Label>
        <Input id="end" name="end" type="date" defaultValue={endYmd} />
      </div>
      <Button type="submit" variant="outline">
        Apply
      </Button>
    </form>
  )
}

function RateBadge({ rate }: { rate: number }) {
  const variant: 'success' | 'warning' | 'destructive' =
    rate < 1.5 ? 'success' : rate < 4 ? 'warning' : 'destructive'
  return <Badge variant={variant}>{rate.toFixed(2)}</Badge>
}

function KpiRow({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        {sub ? <div className="text-xs text-slate-400">{sub}</div> : null}
      </div>
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  )
}
