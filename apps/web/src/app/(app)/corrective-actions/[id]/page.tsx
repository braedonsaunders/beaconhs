import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { FileText } from 'lucide-react'
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
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  correctiveActions,
  incidents,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'in_progress', 'pending_verification', 'closed', 'cancelled'] as const

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) return
  const closing = status === 'closed' || status === 'cancelled'
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ status, closedAt: closing ? new Date() : null, locked: status === 'closed' })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: `Status moved to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
  revalidatePath(`/corrective-actions/${id}`)
  revalidatePath('/corrective-actions')
}

async function updateAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const actionTaken = String(formData.get('actionTaken') ?? '').trim() || null
  const rootCause = String(formData.get('rootCause') ?? '').trim() || null
  const verificationNotes = String(formData.get('verificationNotes') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ actionTaken, rootCause, verificationNotes })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: 'Work notes updated',
    after: { actionTaken, rootCause, verificationNotes },
  })
  revalidatePath(`/corrective-actions/${id}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `CA · ${id.slice(0, 8)}` }
}

export default async function CorrectiveActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        ca: correctiveActions,
        site: orgUnits,
        owner: tenantUsers,
        ownerAccount: user,
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(correctiveActions.id, id))
      .limit(1)
    if (!row) return null

    let source: { type: string; ref?: string; title?: string; href?: string } | null = null
    if (row.ca.sourceEntityType === 'incident' && row.ca.sourceEntityId) {
      const [inc] = await tx.select().from(incidents).where(eq(incidents.id, row.ca.sourceEntityId)).limit(1)
      if (inc) source = { type: 'Incident', ref: inc.reference, title: inc.title, href: `/incidents/${inc.id}` }
    }
    return { ...row, source }
  })
  if (!data) notFound()
  const { ca, site, owner, ownerAccount, source } = data
  const activity = await recentActivityForEntity(ctx, 'corrective_action', id, 25)

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/corrective-actions', label: 'Back to corrective actions' }}
          title={ca.title}
          subtitle={`${ca.reference}${ca.assignedOn ? ` · assigned ${ca.assignedOn}` : ''}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  ca.severity === 'critical' || ca.severity === 'high'
                    ? 'destructive'
                    : ca.severity === 'medium'
                      ? 'warning'
                      : 'secondary'
                }
              >
                {ca.severity}
              </Badge>
              <Badge variant={ca.status === 'closed' ? 'success' : 'warning'}>
                {ca.status.replace('_', ' ')}
              </Badge>
              {ca.locked ? <Badge variant="outline">Locked</Badge> : null}
            </div>
          }
          actions={
            <Button variant="outline">
              <FileText size={14} /> PDF
            </Button>
          }
        />

        {ca.locked ? (
          <Alert variant="warning">
            <AlertTitle>This action is locked</AlertTitle>
            <AlertDescription>Closed on {ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—'}.</AlertDescription>
          </Alert>
        ) : null}

        <Section title="General">
          <DetailGrid
            rows={[
              { label: 'Reference', value: <span className="font-mono">{ca.reference}</span> },
              { label: 'Source', value: source ? (
                <Link href={source.href as any} className="text-teal-700 hover:underline">
                  {source.type} · {source.ref}
                </Link>
              ) : ca.source ?? '—' },
              { label: 'Severity', value: ca.severity },
              { label: 'Status', value: ca.status.replace('_', ' ') },
              { label: 'Site', value: site?.name ?? '—' },
              { label: 'Owner', value: ownerAccount?.name ?? owner?.displayName ?? '—' },
              { label: 'Assigned on', value: ca.assignedOn ?? '—' },
              { label: 'Due on', value: ca.dueOn ?? '—' },
              { label: 'Closed on', value: ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—' },
            ]}
          />
          {ca.description ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Description</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ca.description}</p>
            </div>
          ) : null}
        </Section>

        <Section title="Work">
          <form action={updateAction} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <div>
              <Label>Root cause</Label>
              <Textarea name="rootCause" rows={3} defaultValue={ca.rootCause ?? ''} placeholder="What caused this?" />
            </div>
            <div>
              <Label>Action taken</Label>
              <Textarea name="actionTaken" rows={4} defaultValue={ca.actionTaken ?? ''} placeholder="What's been done to fix it?" />
            </div>
            <div>
              <Label>Verification notes</Label>
              <Textarea
                name="verificationNotes"
                rows={2}
                defaultValue={ca.verificationNotes ?? ''}
                placeholder="What did the verifier check?"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={ca.locked}>
                Save work
              </Button>
            </div>
          </form>
        </Section>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateStatus} className="flex items-end gap-3">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Move to</Label>
                <Select name="status" defaultValue={ca.status}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit">Update</Button>
            </form>
          </CardContent>
        </Card>

        <Section title={`Activity (${activity.length})`} defaultOpen={false}>
          <ActivityFeed entries={activity} />
        </Section>
      </div>
    </PageContainer>
  )
}
