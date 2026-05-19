import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { Bell, Check, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
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
  notifications,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { computeCompliance } from '../_lib/audience'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Assignment · ${id.slice(0, 8)}` }
}

// --- Server actions ------------------------------------------------------

async function sendReminder(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const assignmentId = String(formData.get('assignmentId') ?? '')
  if (!assignmentId) return

  const result = await computeCompliance(ctx, assignmentId)
  const [assignment] = await ctx.db((tx) =>
    tx
      .select({
        id: documentAssignments.id,
        documentId: documentAssignments.documentId,
        title: documentAssignments.title,
      })
      .from(documentAssignments)
      .where(eq(documentAssignments.id, assignmentId))
      .limit(1),
  )
  if (!assignment) return
  const [doc] = await ctx.db((tx) =>
    tx
      .select({ title: documents.title })
      .from(documents)
      .where(eq(documents.id, assignment.documentId))
      .limit(1),
  )

  const outstanding = result.resolved.filter((p) => !result.ackedIds.has(p.id))
  if (outstanding.length === 0) return

  // Resolve the user_id for each person so we can write into the
  // user-keyed notifications table.
  const personRecords = await ctx.db((tx) =>
    tx
      .select({ id: people.id, userId: people.userId })
      .from(people)
      .where(
        inArray(
          people.id,
          outstanding.map((p) => p.id),
        ),
      ),
  )
  const notifRows = personRecords
    .filter((p) => Boolean(p.userId))
    .map((p) => ({
      tenantId: ctx.tenantId,
      userId: p.userId!,
      category: 'document',
      type: 'document.acknowledge_required',
      title: `Reminder: please acknowledge "${doc?.title ?? 'document'}"`,
      body: 'You have an outstanding document acknowledgement. Open the document to read and confirm.',
      linkPath: `/documents/${assignment.documentId}`,
      data: { assignmentId, documentId: assignment.documentId },
    }))
  if (notifRows.length > 0) {
    await ctx.db((tx) => tx.insert(notifications).values(notifRows))
  }

  await recordAudit(ctx, {
    entityType: 'document_assignment',
    entityId: assignmentId,
    action: 'update',
    summary: `Sent reminder to ${outstanding.length} ${outstanding.length === 1 ? 'person' : 'people'}`,
    after: { remindedCount: outstanding.length },
  })
  revalidatePath(`/documents/assignments/${assignmentId}`)
}

async function deleteAssignment(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(documentAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(documentAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_assignment',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted document assignment',
  })
  revalidatePath('/documents/assignments')
}

// --- Page ----------------------------------------------------------------

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({ a: documentAssignments, d: documents })
      .from(documentAssignments)
      .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
      .where(eq(documentAssignments.id, id))
      .limit(1)
    if (!assignment) return null
    const audience = await tx
      .select({
        type: documentAssignmentAudience.type,
        entityKey: documentAssignmentAudience.entityKey,
      })
      .from(documentAssignmentAudience)
      .where(eq(documentAssignmentAudience.assignmentId, id))
    return { ...assignment, audience }
  })

  if (!data) notFound()
  const { a: assignment, d: doc, audience } = data

  const compliance = await computeCompliance(ctx, id)
  const outstanding = compliance.resolved.filter((p) => !compliance.ackedIds.has(p.id))
  const todayIso = new Date().toISOString().slice(0, 10)
  const isOverdue = assignment.dueOn ? assignment.dueOn < todayIso : false

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/assignments', label: 'Back to assignments' }}
          title={assignment.title ?? doc.title}
          subtitle={`Assigned ${new Date(assignment.createdAt).toLocaleDateString()}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={compliance.percent >= 100 ? 'success' : 'secondary'}>
                {compliance.percent}% complete
              </Badge>
              {isOverdue ? <Badge variant="destructive">Overdue</Badge> : null}
            </div>
          }
          actions={
            <>
              <form action={sendReminder} className="inline">
                <input type="hidden" name="assignmentId" value={id} />
                <Button type="submit" variant="outline" disabled={outstanding.length === 0}>
                  <Bell size={14} /> Send reminder ({outstanding.length})
                </Button>
              </form>
              <form action={deleteAssignment} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  <Trash2 size={14} /> Delete
                </Button>
              </form>
            </>
          }
        />
      }
      alerts={
        isOverdue ? (
          <Alert variant="warning">
            <AlertTitle>Assignment is overdue</AlertTitle>
            <AlertDescription>
              The due date {assignment.dueOn} has passed. Send a reminder to outstanding
              acknowledgers, or extend the due date.
            </AlertDescription>
          </Alert>
        ) : null
      }
    >
      <div className="space-y-5">
        <Section title="Overview">
          <DetailGrid
            rows={[
              {
                label: 'Document',
                value: (
                  <Link href={`/documents/${doc.id}`} className="text-teal-700 hover:underline">
                    {doc.title}
                  </Link>
                ),
              },
              { label: 'Title', value: assignment.title ?? '—' },
              { label: 'Due on', value: assignment.dueOn ?? '—' },
              {
                label: 'Compliance',
                value: `${compliance.ackedIds.size} of ${compliance.resolved.length} (${compliance.percent}%)`,
              },
              { label: 'Notes', value: assignment.notes ?? '—' },
              {
                label: 'Audience targets',
                value: audience.length ? `${audience.length}` : '—',
              },
            ]}
          />
        </Section>

        <Section title="Audience targets">
          {audience.length === 0 ? (
            <p className="text-sm text-slate-500">No audience configured.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {audience.map((row, idx) => (
                <li
                  key={`${row.type}-${row.entityKey}-${idx}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary">{row.type}</Badge>
                    <span className="font-mono text-xs text-slate-700">{row.entityKey}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Card>
          <CardHeader>
            <CardTitle>Compliance ({compliance.resolved.length} expected)</CardTitle>
          </CardHeader>
          <CardContent>
            {compliance.resolved.length === 0 ? (
              <EmptyState
                icon={<Check size={24} />}
                title="No matching people"
                description="The audience targets don't resolve to any active people. Check the role keys / trade / department picks."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compliance.resolved.map((p) => {
                    const isAcked = compliance.ackedIds.has(p.id)
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link
                            href={`/people/${p.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {p.firstName} {p.lastName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600">{p.jobTitle ?? '—'}</TableCell>
                        <TableCell className="text-slate-600">{p.email ?? '—'}</TableCell>
                        <TableCell>
                          {isAcked ? (
                            <Badge variant="success">
                              <Check size={10} className="mr-1" />
                              acknowledged
                            </Badge>
                          ) : (
                            <Badge variant="warning">outstanding</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
