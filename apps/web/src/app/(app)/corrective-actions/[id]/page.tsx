import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Building2, Camera, History, Lock, Plus, ShieldCheck, Wrench } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  UrlDrawer,
} from '@beaconhs/ui'
import { pickString } from '@/lib/list-params'
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
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { PremiumSection as Section } from '@/components/premium-section'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import {
  LiveField,
  LivePersonSelect,
  LiveRichText,
  LiveSelect,
  LiveToggle,
} from '@/components/live-field'
import { emitCorrectiveActionCompleted } from '@beaconhs/events'
import { listTenantOwners, reopenCorrectiveAction } from '../_actions'
import { CaHeaderActions } from './_header-actions'
import { CloseBody } from './_close-button'
import { AddStepBody, CompleteStepsTimeline, type CompleteStep } from './_complete-steps-panel'
import { PhotosPanel, type CaPhotoRow } from './_photos-panel'
import { SendEmailBody } from './_send-email-button'
import { VerificationPanel, VerifyBody } from './_verification-panel'

export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'in_progress', 'pending_verification', 'closed', 'cancelled'] as const
const STATUS_NONTERMINAL = ['open', 'in_progress', 'pending_verification', 'cancelled'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SOURCES = [
  'inspection',
  'incident',
  'near_miss',
  'observation',
  'audit',
  'jsha',
  'other',
] as const

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) return
  // Closing happens through the Close+lock action (cost-impact prompt + lock);
  // the header status dropdown is for non-terminal transitions only.
  if (status === 'closed') return
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ status, closedAt: null, locked: false })
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

async function reopenAction(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  await reopenCorrectiveAction(id)
}

// Inline field editor — the single-page form's workhorse. Mirrors the incident
// + hazard-assessment recipe: an allow-list with per-type coercion, a locked
// guard, audit + revalidate.
async function updateTextField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const ENUMS_NOTNULL: Record<string, readonly string[]> = { severity: SEVERITIES }
  const ENUMS_NULLABLE: Record<string, readonly string[]> = { source: SOURCES }
  const NULLABLE_IDS = new Set(['siteOrgUnitId', 'ownerTenantUserId'])
  const DATE_ONLY = new Set(['assignedOn', 'dueOn'])
  const NUMERICS = new Set(['costImpact'])
  const BOOLS = new Set(['verificationRequired'])
  const TEXT_NOTNULL = new Set(['title'])
  const TEXT = new Set(['title', 'description', 'rootCause', 'actionTaken'])

  const allowed =
    field in ENUMS_NOTNULL ||
    field in ENUMS_NULLABLE ||
    NULLABLE_IDS.has(field) ||
    DATE_ONLY.has(field) ||
    NUMERICS.has(field) ||
    BOOLS.has(field) ||
    TEXT.has(field)
  if (!allowed) throw new Error('Field not allowed')

  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ locked: correctiveActions.locked })
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) throw new Error('Corrective action not found')
  if (before.locked) throw new Error('This action is locked')

  let val: unknown
  if (field in ENUMS_NOTNULL) {
    if (!ENUMS_NOTNULL[field]!.includes(value)) throw new Error('Invalid value')
    val = value
  } else if (field in ENUMS_NULLABLE) {
    if (!value) val = null
    else {
      if (!ENUMS_NULLABLE[field]!.includes(value)) throw new Error('Invalid value')
      val = value
    }
  } else if (NULLABLE_IDS.has(field)) {
    val = value || null
  } else if (DATE_ONLY.has(field)) {
    val = value || null
  } else if (NUMERICS.has(field)) {
    if (value.trim() === '') val = null
    else {
      if (Number.isNaN(Number(value))) throw new Error('Invalid number')
      val = value
    }
  } else if (BOOLS.has(field)) {
    val = value === 'true' || value === 'on' || value === '1'
  } else {
    const trimmed = value.trim()
    if (TEXT_NOTNULL.has(field) && trimmed === '') throw new Error('This field is required')
    val = trimmed === '' ? null : value
  }

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ [field]: val } as any)
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/corrective-actions/${id}`)
  revalidatePath('/corrective-actions')
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
  const drawer = pickString(sp.drawer)
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [ca] = await tx
      .select()
      .from(correctiveActions)
      .where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt)))
      .limit(1)
    if (!ca) return null

    let source: { type: string; ref?: string; title?: string; href?: string } | null = null
    if (ca.sourceEntityType === 'incident' && ca.sourceEntityId) {
      const [inc] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.id, ca.sourceEntityId))
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
      .select({ step: caCompleteSteps, byTenantUser: tenantUsers, byUser: user })
      .from(caCompleteSteps)
      .leftJoin(tenantUsers, eq(tenantUsers.id, caCompleteSteps.completedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(caCompleteSteps.caId, id))
      .orderBy(asc(caCompleteSteps.entityOrder))

    let verifierName: string | null = null
    if (ca.verifiedByTenantUserId) {
      const [vRow] = await tx
        .select({ tu: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, ca.verifiedByTenantUserId))
        .limit(1)
      verifierName = vRow?.u?.name ?? vRow?.tu?.displayName ?? null
    }

    const siteOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))

    return { ca, source, photoRows, stepsRaw, verifierName, siteOptions }
  })
  if (!data) notFound()
  const { ca, source, photoRows, stepsRaw, verifierName, siteOptions } = data

  const owners = await listTenantOwners()
  const activity = await recentActivityForEntity(ctx, 'corrective_action', id, 25)
  const locked = ca.locked

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

  const ownerOpts = owners.map((o) => ({
    value: o.id,
    label: o.name,
    hint: o.email ?? undefined,
  }))

  // Progress milestones — the overview hero ring + checklist.
  const milestones = [
    { label: 'Details captured', done: Boolean(ca.title && ca.ownerTenantUserId && ca.dueOn) },
    { label: 'Root cause', done: Boolean(ca.rootCause) },
    {
      label: 'Action taken',
      done: Boolean(ca.actionTaken) || steps.some((s) => s.kind === 'action_taken'),
    },
    ...(ca.verificationRequired ? [{ label: 'Verified', done: Boolean(ca.verifiedAt) }] : []),
    { label: 'Closed', done: ca.status === 'closed' },
  ]
  const doneCount = milestones.filter((m) => m.done).length
  const pct = Math.round((doneCount / milestones.length) * 100)
  const ringCirc = 2 * Math.PI * 26

  const sectionItems: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'work', label: 'Work', count: steps.length || undefined },
    { id: 'photos', label: 'Photos', count: photos.length || undefined },
    ...(ca.verificationRequired
      ? [{ id: 'verification', label: 'Verification', done: Boolean(ca.verifiedAt) }]
      : []),
    { id: 'activity', label: 'Activity', count: activity.length },
  ]

  const basePath = `/corrective-actions/${id}`
  const drawerHref = (key: string) => `${basePath}?drawer=${key}`

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
                className="capitalize"
              >
                {ca.severity}
              </Badge>
              <Badge variant={ca.status === 'closed' ? 'success' : 'warning'} className="capitalize">
                {ca.status.replace(/_/g, ' ')}
              </Badge>
              {locked ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
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
            <CaHeaderActions
              id={id}
              status={ca.status}
              statuses={STATUS_NONTERMINAL}
              locked={locked}
              canClose={!(ca.verificationRequired && !ca.verifiedAt)}
              pdfHref={`${basePath}/pdf`}
              emailHref={drawerHref('send-email')}
              closeHref={drawerHref('close')}
              updateStatusAction={updateStatus}
              reopenAction={reopenAction}
            />
          }
        />
      }
      alerts={
        locked ? (
          <Alert variant="warning">
            <AlertTitle>This action is locked</AlertTitle>
            <AlertDescription>
              Closed on {ca.closedAt ? new Date(ca.closedAt).toLocaleDateString() : '—'}. Reopen from
              the header to edit.
            </AlertDescription>
          </Alert>
        ) : ca.verificationRequired && !ca.verifiedAt ? (
          <Alert variant="info">
            <AlertTitle>Verification pending</AlertTitle>
            <AlertDescription>
              This corrective action can't be closed until a verifier signs off in the Verification
              section.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="space-y-5">
        {/* ===================== OVERVIEW ===================== */}
        <section id="section-overview" className="scroll-mt-2 space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0">
                <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    strokeWidth="6"
                    className="stroke-slate-200 dark:stroke-slate-700"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={ringCirc}
                    strokeDashoffset={ringCirc * (1 - pct / 100)}
                    className={pct >= 100 ? 'stroke-emerald-500' : 'stroke-teal-500'}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {pct}%
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {doneCount} of {milestones.length} steps complete
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  {ca.source ? `${ca.source.replace(/_/g, ' ')} · ` : ''}
                  {ca.reference}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-1 lg:grid-cols-2">
              {milestones.map((m) => (
                <div key={m.label} className="flex items-center gap-2 text-sm">
                  <span
                    className={
                      m.done
                        ? 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white'
                        : 'inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600'
                    }
                  >
                    {m.done ? '✓' : ''}
                  </span>
                  <span
                    className={
                      m.done
                        ? 'text-slate-700 dark:text-slate-200'
                        : 'text-slate-400 dark:text-slate-500'
                    }
                  >
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Section
            title="General"
            subtitle="What, who, when"
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <LiveField
                  id={id}
                  field="title"
                  label="Title"
                  initialValue={ca.title}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveSelect
                id={id}
                field="severity"
                label="Severity"
                initialValue={ca.severity}
                allowEmpty={false}
                options={SEVERITIES.map((s) => ({ value: s, label: s }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="source"
                label="Source category"
                initialValue={ca.source}
                options={SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="siteOrgUnitId"
                label="Site"
                initialValue={ca.siteOrgUnitId}
                options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LivePersonSelect
                id={id}
                field="ownerTenantUserId"
                label="Owner"
                initialValue={ca.ownerTenantUserId}
                options={ownerOpts}
                sheetTitle="Select owner"
                placeholder="Select an owner…"
                searchPlaceholder="Search owners…"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="assignedOn"
                label="Assigned on"
                type="date"
                initialValue={ca.assignedOn}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="dueOn"
                label="Due on"
                type="date"
                initialValue={ca.dueOn}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="costImpact"
                label="Cost impact (USD)"
                type="number"
                initialValue={ca.costImpact != null ? String(ca.costImpact) : null}
                disabled={locked}
                updateAction={updateTextField}
              />
              {source ? (
                <div className="sm:col-span-2">
                  <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Linked source
                  </div>
                  <Link
                    href={source.href as any}
                    className="mt-1 inline-block text-sm text-teal-700 hover:underline dark:text-teal-400"
                  >
                    {source.type} · {source.ref}
                    {source.title ? ` — ${source.title}` : ''}
                  </Link>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <LiveRichText
                  id={id}
                  field="description"
                  label="Description"
                  initialValue={ca.description}
                  placeholder="What needs to be corrected?"
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <div className="sm:col-span-2">
                <LiveToggle
                  id={id}
                  field="verificationRequired"
                  label="Require verification before closing"
                  initialValue={ca.verificationRequired}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
            </div>
          </Section>
        </section>

        {/* ===================== WORK ===================== */}
        <section id="section-work" className="scroll-mt-2">
          <Section
            title="Work"
            subtitle="Root cause, action taken, and the complete-action trail"
            icon={<Wrench size={20} />}
            tone="teal"
          >
            <div className="space-y-5">
              <LiveRichText
                id={id}
                field="rootCause"
                label="Root cause"
                initialValue={ca.rootCause}
                placeholder="What caused this?"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="actionTaken"
                label="Action taken"
                initialValue={ca.actionTaken}
                placeholder="What's been done to fix it?"
                disabled={locked}
                updateAction={updateTextField}
              />
              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Complete-action steps ({steps.length})
                  </h3>
                  {!locked ? (
                    <Link href={drawerHref('add-step') as any} scroll={false}>
                      <Button type="button" size="sm" variant="outline">
                        <Plus size={12} /> Add step
                      </Button>
                    </Link>
                  ) : null}
                </div>
                <CompleteStepsTimeline steps={steps} />
              </div>
            </div>
          </Section>
        </section>

        {/* ===================== PHOTOS ===================== */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={`Photos (${photos.length})`}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <PhotosPanel caId={id} photos={photos} locked={locked} />
          </Section>
        </section>

        {/* ===================== VERIFICATION ===================== */}
        {ca.verificationRequired ? (
          <section id="section-verification" className="scroll-mt-2">
            <Section
              title="Verification"
              subtitle="Independent sign-off before the action can close"
              icon={<ShieldCheck size={20} />}
              tone="emerald"
            >
              <VerificationPanel
                caId={id}
                verifiedAt={ca.verifiedAt}
                verifierName={verifierName}
                verificationNotes={ca.verificationNotes}
                locked={locked}
              />
            </Section>
          </section>
        ) : null}

        {/* ===================== ACTIVITY ===================== */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={`Activity (${activity.length})`}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Edits and status changes show up here." />
            ) : (
              <ActivityFeed entries={activity} />
            )}
          </Section>
        </section>
      </div>

      {/* ===================== DRAWERS ===================== */}
      <UrlDrawer
        open={drawer === 'add-step'}
        closeHref={`${basePath}#section-work`}
        title="Add complete-action step"
        description="Record an action-taken note, a verification check, or capture a signature."
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-work`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="ca-add-step-form">
              Add step
            </Button>
          </>
        }
      >
        <AddStepBody caId={id} formId="ca-add-step-form" closeHref={`${basePath}#section-work`} />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'verify'}
        closeHref={`${basePath}#section-verification`}
        title="Sign verification"
        description="Confirm the corrective action is complete and effective."
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-verification`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="ca-verify-form">
              Sign verification
            </Button>
          </>
        }
      >
        <VerifyBody
          caId={id}
          initialNotes={ca.verificationNotes}
          formId="ca-verify-form"
          closeHref={`${basePath}#section-verification`}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'send-email'}
        closeHref={basePath}
        title={`Send corrective action · ${ca.reference}`}
        description="Email a copy of this corrective action to one or more recipients."
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="ca-send-email-form">
              Send
            </Button>
          </>
        }
      >
        <SendEmailBody caId={id} formId="ca-send-email-form" closeHref={basePath} />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'close'}
        closeHref={basePath}
        title={`Close corrective action · ${ca.reference}`}
        description="Capture cost impact + a close note and lock the record."
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="ca-close-form">
              Close + lock
            </Button>
          </>
        }
      >
        <CloseBody caId={id} formId="ca-close-form" closeHref={basePath} />
      </UrlDrawer>
    </DetailPageLayout>
  )
}
