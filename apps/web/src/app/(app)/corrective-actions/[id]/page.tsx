import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
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
import { isUuid, pickString } from '@/lib/list-params'
import {
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  incidents,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { assertCan } from '@beaconhs/tenant'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAuditInTransaction } from '@/lib/audit'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { PremiumSection as Section } from '@/components/premium-section'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import {
  LiveField,
  LiveRemoteSelect,
  LiveRichText,
  LiveSelect,
  LiveToggle,
} from '@/components/live-field'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { reopenCorrectiveAction } from '../_actions'
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
  assertCan(ctx, 'ca.update')
  const changed = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({
        status: correctiveActions.status,
        locked: correctiveActions.locked,
        ownerTenantUserId: correctiveActions.ownerTenantUserId,
        siteOrgUnitId: correctiveActions.siteOrgUnitId,
      })
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
      .for('update')
    if (!current || current.locked || current.status === status) return false
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [current.ownerTenantUserId],
      siteId: current.siteOrgUnitId,
    })
    if (!visible) return false
    await tx
      .update(correctiveActions)
      .set({ status, closedAt: null, locked: false })
      .where(eq(correctiveActions.id, id))
    if (status === 'pending_verification') {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.completed',
        subjectId: id,
        dedupKey: `corrective_action.completed:${id}:${randomUUID()}`,
        payload: {
          notification: {
            kind: 'corrective_action_completed',
            caId: id,
          },
          web: moduleFlowCommand(ctx, {
            subjectId: id,
            moduleKey: 'corrective-actions',
            event: 'status_change',
            toStatus: status,
          }),
        },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: id,
      action: 'update',
      summary: `Status moved to "${status.replace(/_/g, ' ')}"`,
      after: { status },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
    return true
  })
  if (!changed) return
  revalidatePath(`/corrective-actions/${id}`)
  revalidatePath('/corrective-actions')
}

async function reopenAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const id = String(formData.get('id') ?? '')
  // reopenCorrectiveAction re-resolves context + re-scopes the record itself.
  await reopenCorrectiveAction(id)
}

// Inline field editor — the single-page form's workhorse. Mirrors the incident
// + hazard-assessment recipe: an allow-list with per-type coercion, a locked
// guard, audit + revalidate.
async function updateTextField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
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

  await ctx.db(async (tx) => {
    const [current] = await tx
      .select({
        locked: correctiveActions.locked,
        ownerTenantUserId: correctiveActions.ownerTenantUserId,
        siteOrgUnitId: correctiveActions.siteOrgUnitId,
      })
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
      .for('update')
    if (!current) throw new Error('Corrective action not found')
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [current.ownerTenantUserId],
      siteId: current.siteOrgUnitId,
    })
    if (!visible) throw new Error('Corrective action not found')
    if (current.locked) throw new Error('This action is locked')
    await tx
      .update(correctiveActions)
      .set({ [field]: val } as any)
      .where(eq(correctiveActions.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: id,
      action: 'update',
      summary: `Updated ${field}`,
      after: { [field]: val },
    })
    if (field === 'dueOn' || field === 'ownerTenantUserId') {
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'corrective_action',
        targetRef: {},
      })
    }
  })
  revalidatePath(`/corrective-actions/${id}`)
  revalidatePath('/corrective-actions')
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_129f86a1832647', { value0: id.slice(0, 8) }) }
}

export default async function CorrectiveActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const drawer = pickString(sp.drawer)
  const ctx = await requireRequestContext()
  const pendingGates = await getPendingFlowGatesForSubject(
    ctx,
    'module',
    id,
    canManageSubjectGates(ctx, 'module', 'corrective-actions'),
  )
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

    return { ca, source, photoRows, stepsRaw, verifierName }
  })
  if (!data) notFound()
  // Per-user record visibility: read.all → any; read.site → my sites; else → ones I own.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'ca',
        ownerIds: [data.ca.ownerTenantUserId],
        siteId: data.ca.siteOrgUnitId,
      }),
    ))
  )
    notFound()
  const { ca, source, photoRows, stepsRaw, verifierName } = data

  const activity = await recentActivityForEntity(ctx, 'corrective_action', id, 25)
  const locked = ca.locked

  const photos: CaPhotoRow[] = photoRows.map((p) => ({
    id: p.link.id,
    url: attachmentUrl(p.attachment.id),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const steps: CompleteStep[] = stepsRaw.map((s) => ({
    id: s.step.id,
    kind: s.step.kind,
    description: s.step.description,
    completedAt: s.step.completedAt,
    completedByName: s.byUser?.name ?? s.byTenantUser?.displayName ?? null,
    signatureDataUrl: s.step.signatureAttachmentId
      ? attachmentUrl(s.step.signatureAttachmentId)
      : null,
    entityOrder: s.step.entityOrder,
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
          title={tGeneratedValue(ca.title)}
          subtitle={tGeneratedValue(
            `${ca.reference}${ca.assignedOn ? ` · assigned ${ca.assignedOn}` : ''}`,
          )}
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
                <GeneratedValue value={ca.severity} />
              </Badge>
              <Badge
                variant={ca.status === 'closed' ? 'success' : 'warning'}
                className="capitalize"
              >
                <GeneratedValue value={ca.status.replace(/_/g, ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  locked ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-800">
                      <Lock size={10} className="mr-1" /> <GeneratedText id="m_0e259fa0babc2d" />
                    </Badge>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  ca.verificationRequired ? (
                    <Badge variant="outline" className="border-sky-300 text-sky-800">
                      <GeneratedText id="m_07a541edc3e0c7" />
                    </Badge>
                  ) : null
                }
              />
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
            <AlertTitle>
              <GeneratedText id="m_15ca38df986113" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_01381607e25f0d" />
              <GeneratedValue value={' '} />
              <GeneratedValue
                value={
                  ca.closedAt ? formatDate(new Date(ca.closedAt), ctx.timezone, ctx.locale) : '—'
                }
              />
              <GeneratedText id="m_1d0f03f015029b" />
            </AlertDescription>
          </Alert>
        ) : ca.verificationRequired && !ca.verifiedAt ? (
          <Alert variant="info">
            <AlertTitle>
              <GeneratedText id="m_1c1c6acd0769c9" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_1402c94aca2b1a" />
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="space-y-5">
        <GeneratedValue
          value={pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}
        />
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
                  <GeneratedValue value={pct} />%
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={doneCount} /> <GeneratedText id="m_00e704d1194796" />{' '}
                  <GeneratedValue value={milestones.length} />{' '}
                  <GeneratedText id="m_0562433d6260c9" />
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={ca.source ? `${ca.source.replace(/_/g, ' ')} · ` : ''} />
                  <GeneratedValue value={ca.reference} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-1 lg:grid-cols-2">
              <GeneratedValue
                value={milestones.map((m) => (
                  <div key={m.label} className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        m.done
                          ? 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white'
                          : 'inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600'
                      }
                    >
                      <GeneratedValue value={m.done ? '✓' : ''} />
                    </span>
                    <span
                      className={
                        m.done
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-400 dark:text-slate-500'
                      }
                    >
                      <GeneratedValue value={m.label} />
                    </span>
                  </div>
                ))}
              />
            </div>
          </div>

          <Section
            title={tGenerated('m_1086584d9aca6a')}
            subtitle={tGenerated('m_03ce181c7f3cf6')}
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <LiveField
                  id={id}
                  field="title"
                  label={tGenerated('m_0decefd558c355')}
                  initialValue={ca.title}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveSelect
                id={id}
                field="severity"
                label={tGenerated('m_168b365cc671bf')}
                initialValue={ca.severity}
                allowEmpty={false}
                options={SEVERITIES.map((s) => ({ value: s, label: s }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="source"
                label={tGenerated('m_054b853e6873d3')}
                initialValue={ca.source}
                options={SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="siteOrgUnitId"
                label={tGenerated('m_020146dd3d3d5a')}
                initialValue={ca.siteOrgUnitId}
                lookup="corrective-action-sites"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="ownerTenantUserId"
                label={tGenerated('m_09e0cae12d3f44')}
                initialValue={ca.ownerTenantUserId}
                lookup="corrective-action-owners"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="assignedOn"
                label={tGenerated('m_1e9e6bca0bc9ef')}
                type="date"
                initialValue={ca.assignedOn}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="dueOn"
                label={tGenerated('m_04bfc1eaee3a4b')}
                type="date"
                initialValue={ca.dueOn}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="costImpact"
                label={tGenerated('m_1f434615001b22')}
                type="number"
                initialValue={ca.costImpact != null ? String(ca.costImpact) : null}
                disabled={locked}
                updateAction={updateTextField}
              />
              <GeneratedValue
                value={
                  source ? (
                    <div className="sm:col-span-2">
                      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        <GeneratedText id="m_196b4ac932b0f9" />
                      </div>
                      <Link
                        href={source.href as any}
                        className="mt-1 inline-block text-sm text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <GeneratedValue value={source.type} /> ·{' '}
                        <GeneratedValue value={source.ref} />
                        <GeneratedValue value={source.title ? ` — ${source.title}` : ''} />
                      </Link>
                    </div>
                  ) : null
                }
              />
              <div className="sm:col-span-2">
                <LiveRichText
                  id={id}
                  field="description"
                  label={tGenerated('m_14d923495cf14c')}
                  initialValue={ca.description}
                  placeholder={tGenerated('m_02201d819cd3ca')}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <div className="sm:col-span-2">
                <LiveToggle
                  id={id}
                  field="verificationRequired"
                  label={tGenerated('m_169d0ac6296114')}
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
            title={tGenerated('m_14dd6efe395cda')}
            subtitle={tGenerated('m_1ba7b1917d21bf')}
            icon={<Wrench size={20} />}
            tone="teal"
          >
            <div className="space-y-5">
              <LiveRichText
                id={id}
                field="rootCause"
                label={tGenerated('m_0e04308a7a3472')}
                initialValue={ca.rootCause}
                placeholder={tGenerated('m_0d9ef299d49aed')}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="actionTaken"
                label={tGenerated('m_0da1a29f41377e')}
                initialValue={ca.actionTaken}
                placeholder={tGenerated('m_036d8302ac2cb7')}
                disabled={locked}
                updateAction={updateTextField}
              />
              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_0c51278f3e07ad" />
                    <GeneratedValue value={steps.length} />)
                  </h3>
                  <GeneratedValue
                    value={
                      !locked ? (
                        <Link href={drawerHref('add-step') as any} scroll={false}>
                          <Button type="button" size="sm" variant="outline">
                            <Plus size={12} /> <GeneratedText id="m_0ce705b8fa979c" />
                          </Button>
                        </Link>
                      ) : null
                    }
                  />
                </div>
                <CompleteStepsTimeline steps={steps} />
              </div>
            </div>
          </Section>
        </section>

        {/* ===================== PHOTOS ===================== */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={tGenerated('m_0705e8a460ad79', { value0: photos.length })}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <PhotosPanel caId={id} photos={photos} locked={locked} />
          </Section>
        </section>

        {/* ===================== VERIFICATION ===================== */}
        <GeneratedValue
          value={
            ca.verificationRequired ? (
              <section id="section-verification" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_06bd85b54c842c')}
                  subtitle={tGenerated('m_0a202276c53aae')}
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
            ) : null
          }
        />

        {/* ===================== ACTIVITY ===================== */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={tGenerated('m_158532c8e94ad5', { value0: activity.length })}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <GeneratedValue
              value={
                activity.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_07e310bb161e0f')}
                    description={tGenerated('m_1512653689680a')}
                  />
                ) : (
                  <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
                )
              }
            />
          </Section>
        </section>
      </div>

      {/* ===================== DRAWERS ===================== */}
      <UrlDrawer
        open={drawer === 'add-step'}
        closeHref={`${basePath}#section-work`}
        title={tGenerated('m_014983831ef577')}
        description={tGenerated('m_0ff1c68b440ca9')}
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-work`}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="ca-add-step-form">
              <GeneratedText id="m_0ce705b8fa979c" />
            </Button>
          </>
        }
      >
        <AddStepBody caId={id} formId="ca-add-step-form" closeHref={`${basePath}#section-work`} />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'verify'}
        closeHref={`${basePath}#section-verification`}
        title={tGenerated('m_0fd315c49f4689')}
        description={tGenerated('m_11c79af5be9c70')}
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-verification`}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="ca-verify-form">
              <GeneratedText id="m_0fd315c49f4689" />
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
        title={tGenerated('m_10aedcfd4e3a24', { value0: ca.reference })}
        description={tGenerated('m_0547e4210ef4ca')}
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="ca-send-email-form">
              <GeneratedText id="m_16b55d7868e000" />
            </Button>
          </>
        }
      >
        <SendEmailBody caId={id} formId="ca-send-email-form" closeHref={basePath} />
      </UrlDrawer>

      <UrlDrawer
        open={drawer === 'close'}
        closeHref={basePath}
        title={tGenerated('m_0f1f808447aa0d', { value0: ca.reference })}
        description={tGenerated('m_047e5daf49344f')}
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="ca-close-form">
              <GeneratedText id="m_18770419e64d7e" />
            </Button>
          </>
        }
      >
        <CloseBody caId={id} formId="ca-close-form" closeHref={basePath} />
      </UrlDrawer>
    </DetailPageLayout>
  )
}
