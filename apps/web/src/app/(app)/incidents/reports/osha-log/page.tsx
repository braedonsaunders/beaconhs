// /incidents/reports/osha-log — OSHA 300/300A-style log of recordable
// incidents.  One row per recordable incident, with the columns OSHA
// requires (case number, employee, classification code, days-away,
// days-restricted, outcome).
//
// The "Print" button opens a print-friendly view; the browser's
// "Save as PDF" handles the export.

import Link from 'next/link'
import { and, asc, between, eq, sql } from 'drizzle-orm'
import { FileText, Printer } from 'lucide-react'
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
import {
  incidentClassifications,
  incidentInjuries,
  incidentLostTimeEvents,
  incidents,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../../_sub-nav'
import { IncidentReportsSubNav } from '../_sub-nav'
import { defaultRangeYmd } from '../_lib'

export const metadata = { title: 'OSHA 300 log' }
export const dynamic = 'force-dynamic'

type LogRow = {
  caseNumber: string
  occurredAt: Date
  classification: string | null
  classificationCode: string | null
  isRecordable: boolean
  employeeName: string | null
  jobTitle: string | null
  description: string
  outcome: 'death' | 'days_away' | 'restricted' | 'medical' | 'first_aid' | 'other'
  daysAway: number
  daysRestricted: number
  incidentId: string
}

export default async function OshaLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const fallback = defaultRangeYmd()
  const startYmd = pickString(sp.start) ?? fallback.start
  const endYmd = pickString(sp.end) ?? fallback.end
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const incRows = await tx
      .select({
        inc: incidents,
        cls: incidentClassifications,
      })
      .from(incidents)
      .leftJoin(incidentClassifications, eq(incidentClassifications.id, incidents.classificationId))
      .where(
        and(
          between(sql`date(${incidents.occurredAt})` as any, startYmd as any, endYmd as any),
          // Either explicitly recordable, or unclassified-with-injury (heuristic
          // fallback matches what the frequency report uses).
          sql`(
            (${incidentClassifications.isRecordable} = 1)
            or (${incidents.classificationId} is null and ${incidents.severity} <> 'no_injury')
          )`,
        ),
      )
      .orderBy(asc(incidents.occurredAt))

    // Pull primary injury (first row by created_at) for each incident.
    const incidentIds = incRows.map((r) => r.inc.id)
    const injuryByIncident = new Map<
      string,
      { personName: string | null; jobTitle: string | null }
    >()
    if (incidentIds.length > 0) {
      const injRows = await tx
        .select({
          inj: incidentInjuries,
          person: people,
        })
        .from(incidentInjuries)
        .leftJoin(people, eq(people.id, incidentInjuries.personId))
        .where(
          sql`${incidentInjuries.incidentId} in (${sql.join(
            incidentIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .orderBy(asc(incidentInjuries.createdAt))
      for (const r of injRows) {
        if (!injuryByIncident.has(r.inj.incidentId)) {
          const name = r.person ? `${r.person.lastName}, ${r.person.firstName}` : r.inj.personName
          injuryByIncident.set(r.inj.incidentId, {
            personName: name,
            jobTitle: r.person?.jobTitle ?? null,
          })
        }
      }

      // Per-incident lost-time day totals
      const ltRows = await tx
        .select({
          incidentId: incidentLostTimeEvents.incidentId,
          status: incidentLostTimeEvents.status,
          days: sql<number>`coalesce(${incidentLostTimeEvents.validTo}, current_date) - ${incidentLostTimeEvents.validFrom}`.mapWith(
            Number,
          ),
        })
        .from(incidentLostTimeEvents)
        .where(
          sql`${incidentLostTimeEvents.incidentId} in (${sql.join(
            incidentIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )

      const lostByIncident = new Map<string, { daysAway: number; daysRestricted: number }>()
      for (const r of ltRows) {
        const acc = lostByIncident.get(r.incidentId) ?? { daysAway: 0, daysRestricted: 0 }
        if (r.status === 'off_work') acc.daysAway += Number(r.days)
        else if (r.status === 'restricted_duty') acc.daysRestricted += Number(r.days)
        lostByIncident.set(r.incidentId, acc)
      }

      return incRows.map((row): LogRow => {
        const inj = injuryByIncident.get(row.inc.id)
        const lt = lostByIncident.get(row.inc.id) ?? { daysAway: 0, daysRestricted: 0 }
        const outcome: LogRow['outcome'] =
          row.inc.severity === 'fatality'
            ? 'death'
            : lt.daysAway > 0
              ? 'days_away'
              : lt.daysRestricted > 0
                ? 'restricted'
                : row.inc.severity === 'medical_aid'
                  ? 'medical'
                  : row.inc.severity === 'first_aid_only'
                    ? 'first_aid'
                    : 'other'
        return {
          caseNumber: row.inc.reference,
          occurredAt: row.inc.occurredAt,
          classification: row.cls?.name ?? null,
          classificationCode: row.cls?.code ?? null,
          isRecordable: !!row.cls?.isRecordable,
          employeeName: inj?.personName ?? null,
          jobTitle: inj?.jobTitle ?? null,
          description: row.inc.title,
          outcome,
          daysAway: lt.daysAway,
          daysRestricted: lt.daysRestricted,
          incidentId: row.inc.id,
        }
      })
    }
    return []
  })

  const totals: Record<string, number> = rows.reduce<Record<string, number>>(
    (acc, r) => {
      acc.cases = (acc.cases ?? 0) + 1
      acc.daysAway = (acc.daysAway ?? 0) + r.daysAway
      acc.daysRestricted = (acc.daysRestricted ?? 0) + r.daysRestricted
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
      return acc
    },
    { cases: 0, daysAway: 0, daysRestricted: 0 },
  )

  const printHref = `/incidents/reports/osha-log?print=1&start=${encodeURIComponent(startYmd)}&end=${encodeURIComponent(endYmd)}`
  const isPrint = pickString(sp.print) === '1'

  if (isPrint) {
    return (
      <div className="bg-white p-8 text-xs text-slate-900 print:p-0">
        <header className="mb-6 border-b border-slate-300 pb-3">
          <h1 className="text-lg font-bold tracking-wide uppercase">
            OSHA Form 300A — Summary of Work-Related Injuries and Illnesses
          </h1>
          <div className="mt-1 text-xs text-slate-600">
            Range: {startYmd} → {endYmd} · Generated {new Date().toLocaleString()}
          </div>
        </header>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border border-slate-300 px-2 py-1">Case #</th>
              <th className="border border-slate-300 px-2 py-1">Date</th>
              <th className="border border-slate-300 px-2 py-1">Employee</th>
              <th className="border border-slate-300 px-2 py-1">Job title</th>
              <th className="border border-slate-300 px-2 py-1">Classification</th>
              <th className="border border-slate-300 px-2 py-1">Description</th>
              <th className="border border-slate-300 px-2 py-1 text-right">Days away</th>
              <th className="border border-slate-300 px-2 py-1 text-right">Days rest.</th>
              <th className="border border-slate-300 px-2 py-1">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseNumber}>
                <td className="border border-slate-300 px-2 py-1 font-mono">{r.caseNumber}</td>
                <td className="border border-slate-300 px-2 py-1">
                  {r.occurredAt.toLocaleDateString()}
                </td>
                <td className="border border-slate-300 px-2 py-1">{r.employeeName ?? '—'}</td>
                <td className="border border-slate-300 px-2 py-1">{r.jobTitle ?? '—'}</td>
                <td className="border border-slate-300 px-2 py-1">
                  {r.classificationCode ?? '—'} {r.classification ?? ''}
                </td>
                <td className="border border-slate-300 px-2 py-1">{r.description}</td>
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">
                  {r.daysAway}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">
                  {r.daysRestricted}
                </td>
                <td className="border border-slate-300 px-2 py-1">{outcomeLabel(r.outcome)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td className="border border-slate-300 px-2 py-1" colSpan={6}>
                TOTAL ({totals.cases ?? 0} cases)
              </td>
              <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">
                {totals.daysAway ?? 0}
              </td>
              <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">
                {totals.daysRestricted ?? 0}
              </td>
              <td className="border border-slate-300 px-2 py-1"></td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-xs text-slate-500">
          Generated by BeaconHS. Recordable cases per OSHA 29 CFR 1904.7.
        </p>
      </div>
    )
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="OSHA 300 log"
            description="One row per recordable incident, with the columns OSHA wants. Print to PDF for filing."
            actions={
              <a href={printHref} target="_blank" rel="noopener noreferrer">
                <Button variant="outline">
                  <Printer size={14} /> Print / PDF
                </Button>
              </a>
            }
          />
          <IncidentsSubNav active="reports" />
          <IncidentReportsSubNav active="osha-log" />
          <form
            action="/incidents/reports/osha-log"
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
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <SummaryCard label="Cases" value={totals.cases ?? 0} />
          <SummaryCard label="Days away" value={totals.daysAway ?? 0} />
          <SummaryCard label="Days restricted" value={totals.daysRestricted ?? 0} />
          <SummaryCard label="Fatalities" value={totals.death ?? 0} tone="destructive" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recordable incidents</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Days away</TableHead>
                  <TableHead className="text-right">Days rest.</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-slate-500">
                      No recordable incidents in this range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.caseNumber}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/incidents/${r.incidentId}`}
                          className="text-teal-700 hover:underline"
                        >
                          {r.caseNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {r.occurredAt.toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div>{r.employeeName ?? <span className="text-slate-400">—</span>}</div>
                        {r.jobTitle ? (
                          <div className="text-xs text-slate-500">{r.jobTitle}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.classification ? (
                          <div className="flex items-center gap-2">
                            {r.classificationCode ? (
                              <Badge variant="outline" className="font-mono text-xs">
                                {r.classificationCode}
                              </Badge>
                            ) : null}
                            <span>{r.classification}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Unclassified</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md text-sm text-slate-700">
                        {r.description}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.daysAway}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.daysRestricted}</TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={r.outcome} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ListPageLayout>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'destructive'
}) {
  return (
    <div
      className={`rounded-lg border bg-white px-4 py-3 ${tone === 'destructive' && value > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200'} `}
    >
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold text-slate-900 tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function OutcomeBadge({ outcome }: { outcome: LogRow['outcome'] }) {
  const variant: 'success' | 'warning' | 'destructive' | 'secondary' =
    outcome === 'death'
      ? 'destructive'
      : outcome === 'days_away'
        ? 'warning'
        : outcome === 'restricted'
          ? 'warning'
          : outcome === 'medical'
            ? 'secondary'
            : outcome === 'first_aid'
              ? 'success'
              : 'secondary'
  return <Badge variant={variant}>{outcomeLabel(outcome)}</Badge>
}

function outcomeLabel(outcome: LogRow['outcome']): string {
  switch (outcome) {
    case 'death':
      return 'Fatality'
    case 'days_away':
      return 'Days away'
    case 'restricted':
      return 'Restricted'
    case 'medical':
      return 'Medical aid'
    case 'first_aid':
      return 'First aid'
    case 'other':
    default:
      return 'Other'
  }
}
