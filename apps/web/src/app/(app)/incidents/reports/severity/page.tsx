// /incidents/reports/severity — DART (days away / restricted /
// transferred) rate per period.
//
//   DART = (DART-event count × 200 000) / hours worked
//
// We also surface raw days-away + days-restricted so an admin can spot
// drift between count-based DART and severity-based DART.

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
  dartCountsInRange,
  defaultRangeYmd,
  fmtRate,
  hoursInRange,
  monthBuckets,
  trir,
  OSHA_MULTIPLIER,
} from '../_lib'
import { pickString } from '@/lib/list-params'

export const metadata = { title: 'Severity (DART)' }
export const dynamic = 'force-dynamic'

export default async function SeverityReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const fallback = defaultRangeYmd()
  const startYmd = pickString(sp.start) ?? fallback.start
  const endYmd = pickString(sp.end) ?? fallback.end
  const ctx = await requireRequestContext()
  const buckets = monthBuckets(startYmd, endYmd)

  const overallHours = await hoursInRange(ctx, startYmd, endYmd)
  const overallDart = await dartCountsInRange(ctx, startYmd, endYmd)
  const overallRate = trir(overallDart.dartCount, overallHours.totalHours)
  const severityRate =
    overallHours.totalHours > 0
      ? ((overallDart.daysAway + overallDart.daysRestricted) * OSHA_MULTIPLIER) /
        overallHours.totalHours
      : null

  const rows = await Promise.all(
    buckets.map(async (b) => {
      const h = await hoursInRange(ctx, b.start, b.end)
      const d = await dartCountsInRange(ctx, b.start, b.end)
      return {
        ...b,
        hours: h.totalHours,
        dart: d.dartCount,
        daysAway: d.daysAway,
        daysRestricted: d.daysRestricted,
        rate: trir(d.dartCount, h.totalHours),
      }
    }),
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Severity (DART)"
            description="Days away / restricted / transferred per period. Same OSHA divisor as TRIR."
            actions={
              <Link href="/incidents/hours">
                <Button variant="outline">Manage hours</Button>
              </Link>
            }
          />
          <IncidentsSubNav active="reports" />
          <IncidentReportsSubNav active="severity" />
          <form
            action="/incidents/reports/severity"
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
              <p className="text-sm text-slate-500">Select a date range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">DART events</TableHead>
                    <TableHead className="text-right">Days away</TableHead>
                    <TableHead className="text-right">Days rest.</TableHead>
                    <TableHead className="text-right">DART rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {r.hours > 0 ? r.hours.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.dart}</TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {r.daysAway}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">
                        {r.daysRestricted}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.rate == null ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <DartBadge rate={r.rate} />
                        )}
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
              <Kpi label="Hours worked" value={overallHours.totalHours.toLocaleString()} />
              <Kpi label="DART events" value={overallDart.dartCount.toLocaleString()} />
              <Kpi label="Days away" value={overallDart.daysAway.toLocaleString()} />
              <Kpi label="Days restricted" value={overallDart.daysRestricted.toLocaleString()} />
              <Kpi label="DART rate (range)" value={fmtRate(overallRate)} sub="Benchmark ≈ 1.5" />
              <Kpi
                label="Severity rate"
                value={fmtRate(severityRate)}
                sub="(days_away + days_rest) × 200 000 / hours"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </ListPageLayout>
  )
}

function DartBadge({ rate }: { rate: number }) {
  const variant: 'success' | 'warning' | 'destructive' =
    rate < 0.75 ? 'success' : rate < 2 ? 'warning' : 'destructive'
  return <Badge variant={variant}>{rate.toFixed(2)}</Badge>
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <div>
        <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
        {sub ? <div className="text-xs text-slate-400">{sub}</div> : null}
      </div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}
