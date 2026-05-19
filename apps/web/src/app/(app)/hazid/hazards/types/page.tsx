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
import { Palette } from 'lucide-react'
import { hazidHazardTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { HazidSubNav } from '../../_subnav'

export const metadata = { title: 'Hazard types' }
export const dynamic = 'force-dynamic'

export default async function HazardTypesPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(hazidHazardTypes).orderBy(asc(hazidHazardTypes.name)),
  )
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards/types" />
          <PageHeader
            title="Hazard types"
            description="Categorical buckets (mechanical, chemical, electrical…) for organizing the hazard bank."
            actions={
              <Link href="/hazid/hazards/types/new">
                <Button>New hazard type</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Palette size={32} />}
          title="No hazard types yet"
          description="Start with the basic categories most jobs see."
          action={
            <Link href="/hazid/hazards/types/new">
              <Button>Add a type</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/hazid/hazards/types/${r.id}/edit`} className="font-medium text-slate-900 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" style={{ borderColor: r.color, color: r.color }}>
                    {r.color}
                  </Badge>
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
