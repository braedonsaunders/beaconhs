import Link from 'next/link'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { ClipboardCheck } from 'lucide-react'
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
import {
  documentAssignmentAudience,
  documentAssignments,
  documents,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../_components/documents-sub-nav'
import { computeCompliance } from './_lib/audience'

export const metadata = { title: 'Document assignments' }
export const dynamic = 'force-dynamic'

function complianceBadge(percent: number, resolvedCount: number): React.ReactNode {
  if (resolvedCount === 0) {
    return <Badge variant="outline">no audience</Badge>
  }
  if (percent >= 100) return <Badge variant="success">100%</Badge>
  if (percent >= 80) return <Badge variant="success">{percent}%</Badge>
  if (percent >= 50) return <Badge variant="warning">{percent}%</Badge>
  return <Badge variant="destructive">{percent}%</Badge>
}

function summariseAudience(
  rows: { type: string; entityKey: string }[],
  truncate = 3,
): string {
  if (rows.length === 0) return 'no audience'
  const labels = rows.map((r) => {
    if (r.type === 'everyone') return 'everyone'
    if (r.type === 'role') return `role:${r.entityKey}`
    if (r.type === 'trade') return 'trade'
    if (r.type === 'department') return 'dept'
    return 'person'
  })
  if (labels.length <= truncate) return labels.join(', ')
  return `${labels.slice(0, truncate).join(', ')} +${labels.length - truncate} more`
}

export default async function DocumentAssignmentsPage() {
  const ctx = await requireRequestContext()

  const { rows } = await ctx.db(async (tx) => {
    const data = await tx
      .select({ a: documentAssignments, d: documents })
      .from(documentAssignments)
      .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
      .where(sql`${documentAssignments.deletedAt} is null`)
      .orderBy(desc(documentAssignments.createdAt))
    const audience =
      data.length === 0
        ? []
        : await tx
            .select({
              assignmentId: documentAssignmentAudience.assignmentId,
              type: documentAssignmentAudience.type,
              entityKey: documentAssignmentAudience.entityKey,
            })
            .from(documentAssignmentAudience)
            .orderBy(asc(documentAssignmentAudience.createdAt))
    const audienceByAssignment = new Map<string, { type: string; entityKey: string }[]>()
    for (const row of audience) {
      if (!audienceByAssignment.has(row.assignmentId)) {
        audienceByAssignment.set(row.assignmentId, [])
      }
      audienceByAssignment.get(row.assignmentId)!.push({ type: row.type, entityKey: row.entityKey })
    }
    return { rows: data.map((r) => ({ ...r, audience: audienceByAssignment.get(r.a.id) ?? [] })) }
  })

  // Compute compliance for each (sequential since the audience resolver is
  // moderately expensive — fine for typical N < 100; can be batched later if
  // needed).
  const compliance = new Map<string, { percent: number; resolved: number; acked: number }>()
  for (const row of rows) {
    const result = await computeCompliance(ctx, row.a.id)
    compliance.set(row.a.id, {
      percent: result.percent,
      resolved: result.resolved.length,
      acked: result.ackedIds.size,
    })
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Document assignments"
            description="Assign documents to roles, trades, departments or individual people. Each row shows the audience and rolled-up acknowledgement percentage."
            actions={
              <Link href="/documents/assignments/new">
                <Button>New assignment</Button>
              </Link>
            }
          />
          <DocumentsSubNav active="assignments" />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No assignments yet"
          description="Create an assignment to require a group of workers to acknowledge a specific document."
          action={
            <Link href="/documents/assignments/new">
              <Button>Create your first assignment</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const comp = compliance.get(r.a.id)
              return (
                <TableRow key={r.a.id}>
                  <TableCell>
                    <Link
                      href={`/documents/assignments/${r.a.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.a.title ?? r.d.title}
                    </Link>
                    <div className="text-xs text-slate-500">{r.d.title}</div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {summariseAudience(r.audience)}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.a.dueOn ? r.a.dueOn : '—'}
                  </TableCell>
                  <TableCell>
                    {comp ? (
                      <span className="flex items-center gap-2">
                        {complianceBadge(comp.percent, comp.resolved)}
                        <span className="text-xs text-slate-500">
                          {comp.acked}/{comp.resolved}
                        </span>
                      </span>
                    ) : (
                      <Badge variant="outline">computing…</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(r.a.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
