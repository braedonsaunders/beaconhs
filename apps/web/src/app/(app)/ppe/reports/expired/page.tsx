// /ppe/reports/expired — items whose expiresOn date has passed.
//
// Optionally narrowed by ppe type via ?type=… so reviewers can isolate a
// specific category (e.g. only harnesses).

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { and, asc, eq, lte, type SQL } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Select,
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
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { ReportsSubNav } from '../_sub-nav'

export const metadata = { title: 'Expired PPE' }
export const dynamic = 'force-dynamic'

export default async function ExpiredPpeReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const typeFilter = typeof sp.type === 'string' ? sp.type : undefined
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const { rows, types } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [lte(ppeItems.expiresOn, today)]
    if (typeFilter) filters.push(eq(ppeItems.typeId, typeFilter))
    const data = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(and(...filters))
      .orderBy(asc(ppeItems.expiresOn))
    const allTypes = await tx.select().from(ppeTypes).orderBy(asc(ppeTypes.name))
    return { rows: data, types: allTypes }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="reports" />
          <PageHeader
            title="Expired PPE"
            description="Items whose expires-on date has already passed. Treat each row as a removal-from-service candidate."
          />
          <ReportsSubNav active="expired" />
          <form className="flex items-center gap-2 text-xs" method="get">
            <label className="text-slate-500">Type:</label>
            <Select name="type" defaultValue={typeFilter ?? ''} className="h-8 w-56">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <button className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50">
              Filter
            </button>
          </form>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="No expired PPE"
          description="Nothing in the register has hit its expiry date."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Expired</TableHead>
                <TableHead>Holder</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, type, holder }) => (
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
                  <TableCell className="text-slate-600">{item.size ?? '—'}</TableCell>
                  <TableCell className="text-red-700">{item.expiresOn ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning">{item.status.replace('_', ' ')}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListPageLayout>
  )
}
