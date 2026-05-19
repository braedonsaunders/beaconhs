// /ppe/reports/by-person — per-person PPE roster.
//
// Lists every active person, grouped, with the PPE items they currently hold
// (status='issued', currentHolderPersonId=…). Useful for site supervisors who
// need to know exactly what's in someone's locker before sending them onto
// a job.

import Link from 'next/link'
import { asc, eq, sql } from 'drizzle-orm'
import { Users } from 'lucide-react'
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

export const metadata = { title: 'PPE by person' }
export const dynamic = 'force-dynamic'

export default async function PpeByPersonReport() {
  const ctx = await requireRequestContext()

  const { rows, totalItems, peopleWithPpe } = await ctx.db(async (tx) => {
    const data = await tx
      .select({ person: people, item: ppeItems, type: ppeTypes })
      .from(ppeItems)
      .innerJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .where(eq(ppeItems.status, 'issued'))
      .orderBy(asc(people.lastName), asc(people.firstName), asc(ppeTypes.name))
    const total = data.length
    const uniquePersons = new Set(data.map((r) => r.person.id)).size
    return { rows: data, totalItems: total, peopleWithPpe: uniquePersons }
  })

  const grouped = new Map<string, typeof rows>()
  for (const r of rows) {
    const existing = grouped.get(r.person.id) ?? []
    existing.push(r)
    grouped.set(r.person.id, existing)
  }

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="reports" />
          <PageHeader
            title="PPE by person"
            description="Roster of who currently holds what. One section per person who has at least one issued item."
          />
          <ReportsSubNav active="by-person" />
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary">{peopleWithPpe} people</Badge>
            <Badge variant="secondary">{totalItems} items issued</Badge>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Nobody is holding PPE"
          description="Every PPE item is in stock, returned, or out of service."
        />
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([personId, items]) => {
            const person = items[0]!.person
            return (
              <Section
                key={personId}
                title={`${person.firstName} ${person.lastName} (${items.length})`}
                actions={
                  <Link
                    href={`/people/${personId}`}
                    className="text-xs text-teal-700 hover:underline"
                  >
                    View profile →
                  </Link>
                }
                defaultOpen={false}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Next inspection</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(({ item, type }) => (
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
                        <TableCell className="text-slate-600">{item.size ?? '—'}</TableCell>
                        <TableCell className="text-slate-600">
                          {item.nextInspectionDue ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {item.expiresOn ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
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
