import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { asc, eq, isNull } from 'drizzle-orm'
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
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { HazidSubNav } from '../_subnav'

export const metadata = { title: 'Hazard library' }
export const dynamic = 'force-dynamic'

export default async function HazardsLibraryPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db(async (tx) => {
    return tx
      .select({ h: hazidHazards, type: hazidHazardTypes })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(isNull(hazidHazards.deletedAt))
      .orderBy(asc(hazidHazards.name))
  })
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards" />
          <PageHeader
            title="Hazard library"
            description="The bank of known hazards crews can pull into a job-specific assessment."
            actions={
              <Link href="/hazid/hazards/new">
                <Button>New hazard</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={32} />}
          title="No hazards yet"
          description="Build out a hazard bank so crews don't have to invent it on every job."
          action={
            <Link href="/hazid/hazards/new">
              <Button>Add a hazard</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Standard controls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, type }) => (
              <TableRow key={h.id}>
                <TableCell>
                  <Link href={`/hazid/hazards/${h.id}`} className="font-medium text-slate-900 hover:underline">
                    {h.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {type ? (
                    <Badge
                      variant="outline"
                      style={{ borderColor: type.color, color: type.color }}
                    >
                      {type.name}
                    </Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-xl truncate text-slate-600">
                  {h.standardControls ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
