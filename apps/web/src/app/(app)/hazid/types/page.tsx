import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { asc, isNull } from 'drizzle-orm'
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
import { hazidAssessmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { HazidSubNav } from '../_subnav'

export const metadata = { title: 'Assessment types' }
export const dynamic = 'force-dynamic'

export default async function AssessmentTypesPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(hazidAssessmentTypes)
      .where(isNull(hazidAssessmentTypes.deletedAt))
      .orderBy(asc(hazidAssessmentTypes.name)),
  )
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/types" />
          <PageHeader
            title="Assessment types"
            description='Templates that drive which sections (PPE, Q&A, WAH, CS, AF) appear on new assessments.'
            actions={
              <Link href="/hazid/types/new">
                <Button>New assessment type</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title="No types yet"
          description="Most crews need at least a 'Standard JSHA' and a 'Confined Space JSHA'."
          action={
            <Link href="/hazid/types/new">
              <Button>Add a type</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Sub-forms</TableHead>
              <TableHead>Style</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/hazid/types/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.hasPPE ? <Badge variant="secondary">PPE</Badge> : null}
                    {r.hasQuestions ? <Badge variant="secondary">Q&amp;A</Badge> : null}
                    {r.hasTasks ? <Badge variant="secondary">Tasks</Badge> : null}
                    {r.hasHazards ? <Badge variant="secondary">Hazards</Badge> : null}
                    {r.hasWAH ? <Badge variant="outline">WAH</Badge> : null}
                    {r.hasCS ? <Badge variant="warning">CS</Badge> : null}
                    {r.hasArcFlash ? <Badge variant="destructive">AF</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-slate-600">{r.style.replace('_', '-')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
