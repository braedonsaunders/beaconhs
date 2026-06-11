// /ppe/reports/inspection-due — PPE items due for inspection within N days.
//
// Looks at both nextInspectionDue (pre-use cadence) and nextAnnualInspectionDue
// (annual third-party recertification). The page presents each rollup as a
// separate section so the reviewer can act on whichever bucket they own.

import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { and, asc, eq, isNotNull, lte, type SQL } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { ReportsSubNav } from '../_sub-nav'
import { daysUntil } from '../../_lib'

export const metadata = { title: 'PPE inspection due' }
export const dynamic = 'force-dynamic'

const WINDOWS = [7, 30, 60, 90] as const

export default async function InspectionDuePpeReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rawDays = typeof sp.days === 'string' ? parseInt(sp.days, 10) : 30
  const windowDays = WINDOWS.includes(rawDays as (typeof WINDOWS)[number])
    ? (rawDays as (typeof WINDOWS)[number])
    : 30

  const ctx = await requireRequestContext()
  const today = new Date()
  const future = new Date(today.getTime())
  future.setDate(future.getDate() + windowDays)
  const futureIso = future.toISOString().slice(0, 10)

  const { preUseDue, annualDue } = await ctx.db(async (tx) => {
    const preFilters: SQL<unknown>[] = [
      isNotNull(ppeItems.nextInspectionDue),
      lte(ppeItems.nextInspectionDue, futureIso),
    ]
    const annFilters: SQL<unknown>[] = [
      isNotNull(ppeItems.nextAnnualInspectionDue),
      lte(ppeItems.nextAnnualInspectionDue, futureIso),
    ]
    const pre = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(and(...preFilters))
      .orderBy(asc(ppeItems.nextInspectionDue))
    const ann = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(and(...annFilters))
      .orderBy(asc(ppeItems.nextAnnualInspectionDue))
    return { preUseDue: pre, annualDue: ann }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="reports" />
          <PageHeader
            title="PPE inspection due"
            description="Items whose next inspection (pre-use cadence or annual recertification) falls inside the chosen window."
          />
          <ReportsSubNav active="inspection-due" />
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Window:</span>
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/ppe/reports/inspection-due?days=${w}`}
                className={
                  windowDays === w
                    ? 'rounded-full border border-teal-700 bg-teal-700 px-2 py-0.5 text-white'
                    : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-50'
                }
              >
                {w} days
              </Link>
            ))}
            <Badge variant="secondary">{preUseDue.length} pre-use</Badge>
            <Badge variant="secondary">{annualDue.length} annual</Badge>
          </div>
        </>
      }
    >
      <div className="space-y-6">
        <Section
          title={`Pre-use inspections due (${preUseDue.length})`}
          subtitle="Day-to-day cadence checks; usually 30 days."
          defaultOpen
        >
          {preUseDue.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={24} />}
              title="No pre-use inspections due"
              description={`Nothing inside the next ${windowDays} days.`}
            />
          ) : (
            <DueTable rows={preUseDue} dateKey="nextInspectionDue" />
          )}
        </Section>

        <Section
          title={`Annual inspections due (${annualDue.length})`}
          subtitle="Third-party recertification; usually annual."
          defaultOpen
        >
          {annualDue.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={24} />}
              title="No annual inspections due"
              description={`Nothing inside the next ${windowDays} days.`}
            />
          ) : (
            <DueTable rows={annualDue} dateKey="nextAnnualInspectionDue" />
          )}
        </Section>
      </div>
    </ListPageLayout>
  )
}

function DueTable({
  rows,
  dateKey,
}: {
  rows: {
    item: {
      id: string
      serialNumber: string | null
      nextInspectionDue: string | null
      nextAnnualInspectionDue: string | null
    }
    type: { name: string }
    holder: { firstName: string; lastName: string } | null
  }[]
  dateKey: 'nextInspectionDue' | 'nextAnnualInspectionDue'
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Serial</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Days</TableHead>
          <TableHead>Holder</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ item, type, holder }) => {
          const dueOn = item[dateKey]
          const left = daysUntil(dueOn)
          const overdue = left !== null && left < 0
          return (
            <TableRow key={item.id}>
              <TableCell>
                <Link
                  href={`/ppe/${item.id}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {type.name}
                </Link>
              </TableCell>
              <TableCell className="text-slate-600">{item.serialNumber ?? '—'}</TableCell>
              <TableCell className={overdue ? 'text-red-700' : 'text-slate-600'}>
                {dueOn ?? '—'}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    overdue ? 'destructive' : left !== null && left <= 7 ? 'warning' : 'secondary'
                  }
                >
                  {left ?? '—'}
                </Badge>
              </TableCell>
              <TableCell className="text-slate-600">
                {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
