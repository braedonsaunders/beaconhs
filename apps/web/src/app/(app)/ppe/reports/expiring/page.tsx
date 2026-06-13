// /ppe/reports/expiring — items whose expiresOn falls within the next N days.
//
// Default window is 30 days; query param ?days=60 or ?days=90 lets the
// reviewer widen it. Buckets are 30 / 60 / 90 by default to mirror the
// legacy report which used the same three windows.

import Link from 'next/link'
import { Clock } from 'lucide-react'
import { and, asc, eq, gt, lte, type SQL } from 'drizzle-orm'
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

export const metadata = { title: 'Expiring PPE' }
export const dynamic = 'force-dynamic'

const WINDOWS = [30, 60, 90] as const

export default async function ExpiringPpeReport({
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
  const todayIso = today.toISOString().slice(0, 10)
  const future = new Date(today.getTime())
  future.setDate(future.getDate() + windowDays)
  const futureIso = future.toISOString().slice(0, 10)

  const rows = await ctx.db((tx) => {
    const filters: SQL<unknown>[] = [
      gt(ppeItems.expiresOn, todayIso),
      lte(ppeItems.expiresOn, futureIso),
    ]
    return tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(and(...filters))
      .orderBy(asc(ppeItems.expiresOn))
  })

  // Bucket the rows by 0-30 / 31-60 / 61-90 for quick triage.
  const buckets = new Map<string, typeof rows>()
  for (const r of rows) {
    const d = daysUntil(r.item.expiresOn) ?? 999
    const key = d <= 30 ? '0-30' : d <= 60 ? '31-60' : '61-90'
    const arr = buckets.get(key) ?? []
    arr.push(r)
    buckets.set(key, arr)
  }

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="reports" />
          <PageHeader title="Expiring PPE" description="Items approaching their expiry date." />
          <ReportsSubNav active="expiring" />
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Window:</span>
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/ppe/reports/expiring?days=${w}`}
                className={
                  windowDays === w
                    ? 'rounded-full border border-teal-700 bg-teal-700 px-2 py-0.5 text-white'
                    : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-50'
                }
              >
                {w} days
              </Link>
            ))}
            <Badge variant="secondary">{rows.length} total</Badge>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Clock size={28} />}
          title="Nothing expiring soon"
          description={`No PPE items expire within the next ${windowDays} days.`}
        />
      ) : (
        <div className="space-y-6">
          {(['0-30', '31-60', '61-90'] as const).map((bucket) => {
            const items = buckets.get(bucket) ?? []
            if (items.length === 0) return null
            return (
              <Section
                key={bucket}
                title={`${bucket} days (${items.length})`}
                defaultOpen={bucket === '0-30'}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Days left</TableHead>
                      <TableHead>Holder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(({ item, type, holder }) => {
                      const left = daysUntil(item.expiresOn)
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
                          <TableCell className="text-slate-600">
                            {item.serialNumber ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600">{item.expiresOn}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                left !== null && left <= 30
                                  ? 'destructive'
                                  : left !== null && left <= 60
                                    ? 'warning'
                                    : 'secondary'
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
              </Section>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
