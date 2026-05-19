import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { Send, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
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
  toolboxJournalAssignmentDispatches,
  toolboxJournalAssignments,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { computeAssignmentCompliance } from '../_compliance'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Assignment · ${id.slice(0, 8)}` }
}

async function toggleActive(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  await ctx.db((tx) =>
    tx
      .update(toolboxJournalAssignments)
      .set({ active })
      .where(eq(toolboxJournalAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal_assignment',
    entityId: id,
    action: 'update',
    summary: active ? 'Activated' : 'Deactivated',
    after: { active },
  })
  revalidatePath(`/toolbox/assignments/${id}`)
  revalidatePath('/toolbox/assignments')
}

async function recordDispatch(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db(async (tx) => {
    const [a] = await tx
      .select()
      .from(toolboxJournalAssignments)
      .where(eq(toolboxJournalAssignments.id, id))
      .limit(1)
    if (!a) return
    const dueOn = a.dueOffsetDays
      ? new Date(Date.now() + a.dueOffsetDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : null
    await tx.insert(toolboxJournalAssignmentDispatches).values({
      tenantId: ctx.tenantId,
      assignmentId: id,
      dueOn,
      notes: 'Manual dispatch',
    })
  })
  await recordAudit(ctx, {
    entityType: 'toolbox_journal_assignment',
    entityId: id,
    action: 'update',
    summary: 'Recorded a manual dispatch',
  })
  revalidatePath(`/toolbox/assignments/${id}`)
}

async function deleteAssignment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.delete(toolboxJournalAssignments).where(eq(toolboxJournalAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'toolbox_journal_assignment',
    entityId: id,
    action: 'delete',
    summary: 'Deleted assignment',
  })
  revalidatePath('/toolbox/assignments')
  redirect('/toolbox/assignments')
}

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [a] = await tx
      .select()
      .from(toolboxJournalAssignments)
      .where(eq(toolboxJournalAssignments.id, id))
      .limit(1)
    if (!a) return null
    const dispatches = await tx
      .select()
      .from(toolboxJournalAssignmentDispatches)
      .where(eq(toolboxJournalAssignmentDispatches.assignmentId, id))
      .orderBy(desc(toolboxJournalAssignmentDispatches.occurredAt))
      .limit(50)
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const compliance30 = await computeAssignmentCompliance(tx, ctx.tenantId, a, since30)
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const compliance90 = await computeAssignmentCompliance(tx, ctx.tenantId, a, since90)
    return { a, dispatches, compliance30, compliance90 }
  })
  if (!data) notFound()
  const { a, dispatches, compliance30, compliance90 } = data

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/toolbox/assignments', label: 'Back to assignments' }}
          title={a.name}
          subtitle={a.description ?? `${a.cron}`}
          badge={
            a.active ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )
          }
          actions={
            <>
              <form action={toggleActive} className="inline">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                <Button type="submit" variant="outline">
                  {a.active ? 'Deactivate' : 'Activate'}
                </Button>
              </form>
              <form action={recordDispatch} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  <Send size={14} /> Record dispatch
                </Button>
              </form>
              <form action={deleteAssignment} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button
                  type="submit"
                  variant="outline"
                  className="text-red-700 hover:text-red-900"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </form>
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <Section title="Rule">
          <DetailGrid
            rows={[
              { label: 'Cadence (cron)', value: <span className="font-mono">{a.cron}</span> },
              { label: 'Due offset', value: `${a.dueOffsetDays} day(s)` },
              { label: 'Compliant threshold', value: `${a.compliantPercentage}%` },
              {
                label: 'Audience: roles',
                value: (a.audience?.roleKeys ?? []).join(', ') || 'Any',
              },
              {
                label: 'Audience: people',
                value: a.audience?.personIds?.length
                  ? `${a.audience.personIds.length} selected`
                  : 'Any',
              },
              {
                label: 'Audience: sites',
                value: a.audience?.orgUnitIds?.length
                  ? `${a.audience.orgUnitIds.length} selected`
                  : 'Any',
              },
              { label: 'Active', value: a.active ? 'Yes' : 'No' },
              { label: 'Created', value: new Date(a.createdAt).toLocaleDateString() },
            ]}
          />
        </Section>

        <Section
          title={`Compliance (last 30 days · ${
            compliance30.percent == null ? '—' : `${compliance30.percent.toFixed(0)}%`
          })`}
        >
          <ComplianceBlock res={compliance30} threshold={a.compliantPercentage} />
        </Section>

        <Section
          title={`Compliance (last 90 days · ${
            compliance90.percent == null ? '—' : `${compliance90.percent.toFixed(0)}%`
          })`}
          defaultOpen={false}
        >
          <ComplianceBlock res={compliance90} threshold={a.compliantPercentage} />
        </Section>

        <Section title={`Dispatch log (${dispatches.length})`}>
          {dispatches.length === 0 ? (
            <EmptyState
              icon={<Send size={20} />}
              title="No dispatches recorded yet"
              description="A dispatch is logged each time the worker fires this assignment, or you press “Record dispatch” manually."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Occurred at</TableHead>
                  <TableHead>Due on</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{new Date(d.occurredAt).toLocaleString()}</TableCell>
                    <TableCell>{d.dueOn ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{d.notes ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </DetailPageLayout>
  )
}

function ComplianceBlock({
  res,
  threshold,
}: {
  res: { total: number; compliant: number; percent: number | null; perMember: { id: string; name: string; logged: number; compliant: boolean }[] }
  threshold: number
}) {
  if (res.total === 0) {
    return (
      <p className="text-sm text-slate-500">
        Audience resolved to 0 members — no measurement possible.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600">
        {res.compliant} of {res.total} members logged at least 1 toolbox talk · threshold{' '}
        {threshold}%
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="text-right">Logged</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.perMember.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <Link
                  href={`/toolbox/transcripts/${m.id}`}
                  className="hover:underline"
                >
                  {m.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">{m.logged}</TableCell>
              <TableCell>
                {m.compliant ? (
                  <Badge variant="success">On track</Badge>
                ) : (
                  <Badge variant="destructive">Behind</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
