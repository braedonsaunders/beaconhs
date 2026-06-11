// /incidents/reports/trends — monthly trend chart of incident count by
// type / severity.  Rendered as an inline SVG stacked-bar chart so we
// don't pull in a charting library just for this view.

import { and, between, count, eq, sql } from 'drizzle-orm'
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
import { incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../../_sub-nav'
import { IncidentReportsSubNav } from '../_sub-nav'
import { defaultRangeYmd, monthBuckets } from '../_lib'

export const metadata = { title: 'Trends' }
export const dynamic = 'force-dynamic'

const TYPE_COLORS: Record<string, string> = {
  injury: '#dc2626',
  illness: '#a855f7',
  near_miss: '#eab308',
  property_damage: '#f97316',
  environmental: '#16a34a',
  security: '#0ea5e9',
  other: '#64748b',
}
const TYPES_ORDER = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const

const SEVERITY_COLORS: Record<string, string> = {
  fatality: '#7f1d1d',
  lost_time: '#dc2626',
  medical_aid: '#f97316',
  first_aid_only: '#eab308',
  no_injury: '#64748b',
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const fallback = defaultRangeYmd()
  const startYmd = pickString(sp.start) ?? fallback.start
  const endYmd = pickString(sp.end) ?? fallback.end
  const splitBy = (pickString(sp.split) ?? 'type') as 'type' | 'severity'

  const ctx = await requireRequestContext()
  const buckets = monthBuckets(startYmd, endYmd)

  // Aggregate in a single query: group by yyyy-mm + the chosen split.
  const groupCol = splitBy === 'severity' ? incidents.severity : incidents.type
  const rawRows = await ctx.db((tx) =>
    tx
      .select({
        month: sql<string>`to_char(${incidents.occurredAt}, 'YYYY-MM')`.as('month'),
        bucket: groupCol,
        c: count(),
      })
      .from(incidents)
      .where(
        and(between(sql`date(${incidents.occurredAt})` as any, startYmd as any, endYmd as any)),
      )
      .groupBy(sql`to_char(${incidents.occurredAt}, 'YYYY-MM')`, groupCol)
      .orderBy(sql`to_char(${incidents.occurredAt}, 'YYYY-MM')`),
  )

  // Pivot to a per-bucket map: { 'YYYY-MM': { injury: 3, illness: 0, … } }.
  const palette = splitBy === 'severity' ? SEVERITY_COLORS : TYPE_COLORS
  const seriesKeys =
    splitBy === 'severity' ? Object.keys(SEVERITY_COLORS) : (TYPES_ORDER as readonly string[])

  const monthMap = new Map<string, Record<string, number>>()
  for (const b of buckets) monthMap.set(b.key, {})
  for (const r of rawRows) {
    const cell = monthMap.get(r.month) ?? {}
    cell[r.bucket as string] = (cell[r.bucket as string] ?? 0) + Number(r.c)
    monthMap.set(r.month, cell)
  }

  // Compute the max stack height so the SVG scales properly.
  let maxStack = 0
  for (const cell of monthMap.values()) {
    const sum = Object.values(cell).reduce((a, b) => a + b, 0)
    if (sum > maxStack) maxStack = sum
  }
  const seriesTotals: Record<string, number> = {}
  for (const cell of monthMap.values()) {
    for (const [k, v] of Object.entries(cell)) {
      seriesTotals[k] = (seriesTotals[k] ?? 0) + v
    }
  }
  const grandTotal = Object.values(seriesTotals).reduce((a, b) => a + b, 0)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Trends"
            description="Monthly count of incidents, stacked by type or severity."
          />
          <IncidentsSubNav active="reports" />
          <IncidentReportsSubNav active="trends" />
          <form
            action="/incidents/reports/trends"
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
            <div className="space-y-1.5">
              <Label htmlFor="split">Split by</Label>
              <select
                id="split"
                name="split"
                defaultValue={splitBy}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="type">Type</option>
                <option value="severity">Severity</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
        </>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              Monthly stack — {splitBy === 'severity' ? 'by severity' : 'by type'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {buckets.length === 0 ? (
              <p className="text-sm text-slate-500">No buckets in this range.</p>
            ) : (
              <StackedBarChart
                buckets={buckets}
                monthMap={monthMap}
                seriesKeys={seriesKeys}
                palette={palette}
                maxStack={Math.max(maxStack, 1)}
              />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
              {seriesKeys.map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: palette[k] ?? '#94a3b8' }}
                  />
                  <span className="text-slate-600">{k.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-slate-900 tabular-nums">
                    {(seriesTotals[k] ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
              <span className="ml-auto text-slate-500">
                Total: <strong>{grandTotal.toLocaleString()}</strong>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Raw counts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  {seriesKeys.map((k) => (
                    <TableHead key={k} className="text-right">
                      {k.replace(/_/g, ' ')}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((b) => {
                  const cell = monthMap.get(b.key) ?? {}
                  const rowTotal = Object.values(cell).reduce((a, n) => a + n, 0)
                  return (
                    <TableRow key={b.key}>
                      <TableCell className="font-medium">{b.label}</TableCell>
                      {seriesKeys.map((k) => (
                        <TableCell key={k} className="text-right tabular-nums">
                          {cell[k] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">
                        {rowTotal}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ListPageLayout>
  )
}

// Inline SVG stacked bar chart — no client JS, no chart lib.
function StackedBarChart({
  buckets,
  monthMap,
  seriesKeys,
  palette,
  maxStack,
}: {
  buckets: { key: string; label: string }[]
  monthMap: Map<string, Record<string, number>>
  seriesKeys: readonly string[]
  palette: Record<string, string>
  maxStack: number
}) {
  const width = Math.max(640, buckets.length * 56 + 64)
  const height = 280
  const padding = { top: 12, right: 16, bottom: 36, left: 32 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const barW = Math.max(16, Math.floor((innerW - 16) / Math.max(1, buckets.length)) - 8)
  const yScale = (n: number) => innerH - (n / maxStack) * innerH

  const yTicks = 4
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round((maxStack * i) / yTicks),
  )

  return (
    <div className="w-full overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Monthly incident stack"
      >
        {/* y-axis grid + labels */}
        {tickValues.map((tv, i) => {
          const y = padding.top + yScale(tv)
          return (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={i === 0 ? '' : '2,2'}
              />
              <text
                x={padding.left - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[10px]"
              >
                {tv}
              </text>
            </g>
          )
        })}

        {/* bars */}
        {buckets.map((b, i) => {
          const cell = monthMap.get(b.key) ?? {}
          const x = padding.left + 8 + i * (barW + 8)
          let stackY = innerH
          return (
            <g key={b.key}>
              {seriesKeys.map((k) => {
                const v = cell[k] ?? 0
                if (v === 0) return null
                const h = (v / maxStack) * innerH
                stackY -= h
                return (
                  <rect
                    key={k}
                    x={x}
                    y={padding.top + stackY}
                    width={barW}
                    height={h}
                    fill={palette[k] ?? '#94a3b8'}
                  >
                    <title>{`${b.label} · ${k.replace(/_/g, ' ')}: ${v}`}</title>
                  </rect>
                )
              })}
              <text
                x={x + barW / 2}
                y={height - 16}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {b.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
