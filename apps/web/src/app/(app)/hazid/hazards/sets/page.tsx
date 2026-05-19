import Link from 'next/link'
import { asc } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { Boxes } from 'lucide-react'
import { hazidHazardSets } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { HazidSubNav } from '../../_subnav'

export const metadata = { title: 'Hazard sets' }
export const dynamic = 'force-dynamic'

export default async function HazardSetsPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) => tx.select().from(hazidHazardSets).orderBy(asc(hazidHazardSets.name)))
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards/sets" />
          <PageHeader
            title="Hazard sets"
            description="Bundles of related hazards that can be added to an assessment in one click."
            actions={
              <Link href="/hazid/hazards/sets/new">
                <Button>New hazard set</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title="No hazard sets yet"
          description="Group commonly-co-occurring hazards together to speed up assessments."
          action={
            <Link href="/hazid/hazards/sets/new">
              <Button>Create one</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Hazards in set</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/hazid/hazards/sets/${r.id}/edit`} className="font-medium text-slate-900 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.hazardIds.length}</Badge>
                </TableCell>
                <TableCell className="text-slate-600">{r.description ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
