import Link from 'next/link'
import { desc, sql } from 'drizzle-orm'
import { Gavel } from 'lucide-react'
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
import { documentManagementReviews } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../_components/documents-sub-nav'
import { createManagementReview } from './[id]/actions'

export const metadata = { title: 'Management reviews' }
export const dynamic = 'force-dynamic'

export default async function ManagementReviewsPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(documentManagementReviews)
      .where(sql`${documentManagementReviews.deletedAt} is null`)
      .orderBy(desc(documentManagementReviews.periodEnd)),
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Management reviews"
            description="Annual / scheduled board reviews of the SH&S management system — discussion notes, decisions, follow-up actions and next-review dates."
            actions={
              <form action={createManagementReview}>
                <Button type="submit">New review</Button>
              </form>
            }
          />
          <DocumentsSubNav active="management-reviews" />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Gavel size={32} />}
          title="No management reviews recorded"
          description="Capture each annual / quarterly board review of the SH&S system — the documents covered, decisions made, and follow-up actions."
          action={
            <form action={createManagementReview}>
              <Button type="submit">Record first review</Button>
            </form>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Participants</TableHead>
              <TableHead>Documents reviewed</TableHead>
              <TableHead>Next review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/documents/management-reviews/${r.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-600">
                  {r.periodStart ? `${r.periodStart} → ` : ''}
                  {r.periodEnd}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{r.participants.length}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.documentsReviewed.length}</Badge>
                </TableCell>
                <TableCell className="text-slate-600">{r.nextReviewOn ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
