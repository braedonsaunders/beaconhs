import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { FileText, Lock, Unlock } from 'lucide-react'
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
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  incidents,
  orgUnits,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { CheckIndicator } from '@/components/checkbox-field'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { emitCorrectiveActionCompleted } from '@beaconhs/events'
import { reopenCorrectiveAction, setVerificationRequired } from '../_actions'
import { CloseButton } from './_close-button'
import { CompleteStepsPanel, type CompleteStep } from './_complete-steps-panel'
import { PhotosPanel, type CaPhotoRow } from './_photos-panel'
import { SendEmailButton } from './_send-email-button'
import { VerificationPanel } from './_verification-panel'

export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'in_progress', 'pending_verification', 'closed', 'cancelled'] as const
const CA_TABS = [
  'overview',
  'work',
  'photos',
  'verification',
  'status',
  'activity',
] as const
type CaTab = (typeof CA_TABS)[number]

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) return
  // Closing happens through the CloseButton (cost-impact prompt + lock); the
  // bare status dropdown is for non-terminal transitions only.
  if (status === 'closed') return
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({
        status,
        // Cancelling clears the closedAt timestamp + lock so the row can be
        // reopened later without surfacing a stale closed-date.
        closedAt: status === 'cancelled' ? null : null,
        locked: false,
      })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: `Status moved to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
  if (status === 'pending_verification') {
    await emitCorrectiveActionCompleted(ctx, { caId: id, completerUserId: ctx.userId })
  }
  revalidatePath(`/corrective-actions/${id}`)
  revalidatePath('/corrective-actions')
}

async function updateAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const actionTaken = String(formData.get('actionTaken') ?? '').trim() || null
  const rootCause = String(formData.get('rootCause') ?? '').trim() || null
  const requireVerification = formData.get('verificationRequired') === 'on'
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ actionTaken, rootCause, verificationRequired: requireVerification })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: 'Work notes updated',
    after: { actionTaken, rootCause, verificationRequired: requireVerification },
  })
  revalidatePath(`/corrective-actions/${id}`)
}

async function reopenAction(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  await reopenCorrectiveAction(id)
}

async function toggleVerification(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  const required = formData.get('required') === 'true'
  await setVerificationRequired(id, required)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `CA · ${id.slice(0, 8)}` }
}

export default async function CorrectiveActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        ca: correctiveActions,
        site: orgUnits,
        owner: tenantUsers,
        ownerAccount: user,
        verifier: {
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
        },
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
      const [inc] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.id, row.ca.sourceEntityId))
        .limit(1)
      if (inc)
        source = {
          type: 'Incident',
          ref: inc.reference,
          title: inc.title,
          href: `/incidents/${inc.id}`,
        }
    }

    const photoRows = await tx
      .select({ link: caPhotos, attachment: attachments })
      .from(caPhotos)
      .innerJoin(attachments, eq(attachments.id, caPhotos.attachmentId))
      .where(eq(caPhotos.caId, id))

    const stepsRaw = await tx
      .select({
        step: caCompleteSteps,
        byTenantUser: tenantUsers,
        byUser: user,
      })
      .from(caCompleteSteps)
      .leftJoin(tenantUsers, eq(tenantUsers.id, caCompleteSteps.completedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(caCompleteSteps.caId, id))
      .orderBy(asc(caCompleteSteps.entityOrder))

    // Resolve verifier name (separate join because the main row already uses
    // tenantUsers for the owner — Drizzle joins are positional, not named).
    let verifierName: string | null = null
    if (row.ca.verifiedByTenantUserId) {
      const [vRow] = await tx
        .select({ tu: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.ca.verifiedByTenantUserId))
        .limit(1)
      verifierName = vRow?.u?.name ?? vRow?.tu?.displayName ?? null
    }

    return { ...row, source, photoRows, stepsRaw, verifierName }
  })
  if (!data) notFound()
  const { ca, site, owner, ownerAccount, source, photoRows, stepsRaw, verifierName } = data

  const tabsAvailable = CA_TABS.filter((t) => t !== 'verification' || ca.verificationRequired)
  const active: CaTab = pickActiveTab(sp, tabsAvailable, 'overview')

  const activity = await recentActivityForEntity(ctx, 'corrective_action', id, 25)

  const photos: CaPhotoRow[] = photoRows.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const steps: CompleteStep[] = stepsRaw.map((s) => ({
    id: s.step.id,
    kind: s.step.kind,
    description: s.step.description,
    completedAt: s.step.completedAt,
    completedByName: s.byUser?.name ?? s.byTenantUser?.displayName ?? null,
    signatureDataUrl: s.step.signatureDataUrl,
    entityOrder: s.step.entityOrder,
  }))

  const basePath = `/corrective-actions/${id}`
  return (
    <DetailPageLayout
      header={
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
              {ca.locked ? (
                <Badge variant="outline">
                  <Lock size={10} className="mr-1" /> Locked
                </Badge>
              ) : null}
              {ca.verificationRequired ? (
                <Badge variant="outline" className="border-sky-300 text-sky-800">
                  Verification required
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/corrective-actions/${id}/pdf` as any} target="_blank">
                <Button variant="outline" type="button">
                  <FileText size={14} />
                  PDF
                </Button>
              </Link>
              <SendEmailButton caId={id} reference={ca.reference} />
              {!ca.locked ? (
                <CloseButton
                  caId={id}
                  reference={ca.reference}
                  verificationRequired={ca.verificationRequired}
                  verifiedAt={ca.verifiedAt}
                />
              ) : (
                <form action={reopenAction}>
                  <input type="hidden" name="id" value={id} />
                  <Button variant="outline" type="submit">
                    <Unlock size={14} />
                    Reopen
                  </Button>
                </form>
              )}
            </>
          }
        />
      }
      alerts={
        ca.locked ? (
          <Alert variant="warning">
            <AlertTitle>This action is locked</AlertTitle>
            <AlertDescription>
              Closed on {ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—'}.
              Reopen from the header to edit.
            </AlertDescription>
          </Alert>
        ) : ca.verificationRequired && !ca.verifiedAt ? (
          <Alert variant="info">
            <AlertTitle>Verification pending</AlertTitle>
            <AlertDescription>
              This corrective action can't be closed until a verifier signs off
              on the Verification tab.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'work', label: 'Work', count: steps.length || undefined },
            { key: 'photos', label: 'Photos', count: photos.length || undefined },
            ...(ca.verificationRequired
              ? [{ key: 'verification', label: 'Verification' } as const]
              : []),
            { key: 'status', label: 'Status' },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General">
              <DetailGrid
                rows={[
                  { label: 'Reference', value: <span className="font-mono">{ca.reference}</span> },
                  {
                    label: 'Source',
                    value: source ? (
                      <Link href={source.href as any} className="text-teal-700 hover:underline">
                        {source.type} · {source.ref}
                      </Link>
                    ) : (
                      ca.source ?? '—'
                    ),
                  },
                  { label: 'Severity', value: ca.severity },
                  { label: 'Status', value: ca.status.replace('_', ' ') },
                  { label: 'Site', value: site?.name ?? '—' },
                  { label: 'Owner', value: ownerAccount?.name ?? owner?.displayName ?? '—' },
                  { label: 'Assigned on', value: ca.assignedOn ?? '—' },
                  { label: 'Due on', value: ca.dueOn ?? '—' },
                  {
                    label: 'Closed on',
                    value: ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—',
                  },
                  {
                    label: 'Cost impact',
                    value:
                      ca.costImpact != null && ca.costImpact !== ''
                        ? formatMoney(Number(ca.costImpact))
                        : '—',
                  },
                ]}
              />
              {ca.description ? (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Description</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ca.description}</p>
                </div>
              ) : null}
            </Section>

            <Section title="Verification settings" defaultOpen={false}>
              <div className="flex items-center justify-between">
                <CheckIndicator
                  checked={ca.verificationRequired}
                  label="Sign-off required before closing"
                />
                {!ca.locked ? (
                  <form action={toggleVerification}>
                    <input type="hidden" name="id" value={id} />
                    <input
                      type="hidden"
                      name="required"
                      value={ca.verificationRequired ? 'false' : 'true'}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      {ca.verificationRequired ? 'Waive' : 'Require'} verification
                    </Button>
                  </form>
                ) : null}
              </div>
            </Section>
          </>
        ) : null}

        {active === 'work' ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
            <Section title="Work notes">
              <form action={updateAction} className="space-y-4">
                <input type="hidden" name="id" value={id} />
                <div>
                  <Label>Root cause</Label>
                  <Textarea
                    name="rootCause"
                    rows={3}
                    defaultValue={ca.rootCause ?? ''}
                    placeholder="What caused this?"
                    disabled={ca.locked}
                  />
                </div>
                <div>
                  <Label>Action taken (summary)</Label>
                  <Textarea
                    name="actionTaken"
                    rows={4}
                    defaultValue={ca.actionTaken ?? ''}
                    placeholder="What's been done to fix it?"
                    disabled={ca.locked}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="verificationRequired"
                    defaultChecked={ca.verificationRequired}
                    disabled={ca.locked}
                  />
                  Require verification before closing
                </label>
                <div className="flex justify-end">
                  <Button type="submit" disabled={ca.locked}>
                    Save work
                  </Button>
                </div>
              </form>
            </Section>
            <Section title={`Complete-action steps (${steps.length})`}>
              <CompleteStepsPanel caId={id} steps={steps} locked={ca.locked} />
            </Section>
          </div>
        ) : null}

        {active === 'photos' ? (
          <Section title={`Photos (${photos.length})`}>
            <PhotosPanel caId={id} photos={photos} locked={ca.locked} />
          </Section>
        ) : null}

        {active === 'verification' && ca.verificationRequired ? (
          <Section title="Verification">
            <VerificationPanel
              caId={id}
              verifiedAt={ca.verifiedAt}
              verifierName={verifierName}
              verificationNotes={ca.verificationNotes}
              locked={ca.locked}
            />
          </Section>
        ) : null}

        {active === 'status' ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Use this dropdown for non-terminal transitions only. To close +
                lock, use the "Close + lock" button at the top of the page so the
                cost-impact prompt is captured.
              </p>
              <form action={updateStatus} className="flex items-end gap-3">
                <input type="hidden" name="id" value={id} />
                <div className="space-y-1.5">
                  <Label>Move to</Label>
                  <Select name="status" defaultValue={ca.status} disabled={ca.locked}>
                    {STATUSES.filter((s) => s !== 'closed').map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" disabled={ca.locked}>
                  Update
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`}>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}
