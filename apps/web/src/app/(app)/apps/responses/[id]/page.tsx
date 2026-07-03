import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { aliasedTable, and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  LockOpen,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
  Undo2,
} from 'lucide-react'
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
  Textarea,
} from '@beaconhs/ui'
import {
  correctiveActions,
  formAutomations,
  formResponseCheckins,
  formResponseComments,
  formResponseScores,
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  formTemplates,
  incidents,
  orgUnits,
  people,
  tenantUsers,
  user,
  type FormResponseDraftData,
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import { evaluateLogicRule } from '@beaconhs/forms-core'
import { loadEntitiesForPickers } from '@/app/(app)/apps/_lib/entity-loader'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { pickString } from '@/lib/list-params'
import { WorkflowPanel, type WorkflowStepProp } from './_workflow-panel'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { createCorrectiveActionFromResponse, createIncidentFromResponse } from './_spawn-actions'
import { buildSpawnPrefill, labelForField } from './_spawn-prefill'
import { SpawnDrawers, type SpawnDrawerKind } from './_spawn-drawers'
import { MonitorPanel, type MonitorStatus } from './_monitor-panel'
import { can } from '@beaconhs/tenant'
import { appVisibleTo, getUserRoleKeys } from '@/app/(app)/apps/_lib/access'
import { FormRenderer } from '@/app/(app)/apps/templates/[id]/fill/form-renderer'
import {
  finalizeResponse,
  lockResponse,
  reopenResponse,
  unlockResponse,
} from './_lifecycle-actions'
import { RecordActionBar } from './_record-action-bar'

export const dynamic = 'force-dynamic'

const TABS = ['response', 'comments', 'audit'] as const
type Tab = (typeof TABS)[number]

function hasAnyRole(roleKeys: ReadonlySet<string>, allowed: string[] | null | undefined): boolean {
  return !!allowed && allowed.length > 0 && allowed.some((r) => roleKeys.has(r))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Form response · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function addComment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!responseId || !body) return
  if (!ctx.membership?.id) return
  // Per-user record visibility re-check: the page render is scoped, but this
  // action is reachable directly, so a user must be able to see the response
  // before commenting on it (read.all → any; read.site → my sites; else → mine).
  const target = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        submittedBy: formResponses.submittedBy,
        subjectPersonId: formResponses.subjectPersonId,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!target) return
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [target.submittedBy],
        personId: target.subjectPersonId,
        siteId: target.siteOrgUnitId,
      }),
    ))
  )
    return
  await ctx.db((tx) =>
    tx.insert(formResponseComments).values({
      tenantId: ctx.tenantId,
      responseId,
      authorTenantUserId: ctx.membership!.id,
      body,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Comment added',
  })
  revalidatePath(`/apps/responses/${responseId}`)
}

// `reopenResponse` / `lockResponse` / `unlockResponse` / `finalizeResponse` are
// the shared record-lifecycle server actions, imported from `./_lifecycle-actions`.

// ---------- Page ----------

export default async function FormResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'response')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        version: formTemplateVersions,
        site: orgUnits,
        subjectPerson: people,
        submitterMembership: tenantUsers,
        submitterAccount: user,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(eq(formResponses.id, id), isNull(formResponses.deletedAt)))
      .limit(1)
    if (!row) return null
    // Aliased joins so we can attach signer + rejector display names to each
    // step row in a single query.
    const signerTu = aliasedTable(tenantUsers, 'signer_tu')
    const signerUser = aliasedTable(user, 'signer_user')
    const signerPerson = aliasedTable(people, 'signer_person')
    const rejectorTu = aliasedTable(tenantUsers, 'rejector_tu')
    const rejectorUser = aliasedTable(user, 'rejector_user')

    const [steps, comments, scoreRows, spawnedCAs, spawnedIncidents, checkins] = await Promise.all([
      tx
        .select({
          step: formResponseSteps,
          signerTu,
          signerUser,
          signerPerson,
          rejectorTu,
          rejectorUser,
        })
        .from(formResponseSteps)
        .leftJoin(signerTu, eq(signerTu.id, formResponseSteps.signedByTenantUserId))
        .leftJoin(signerUser, eq(signerUser.id, signerTu.userId))
        .leftJoin(signerPerson, eq(signerPerson.id, formResponseSteps.signedByPersonId))
        .leftJoin(rejectorTu, eq(rejectorTu.id, formResponseSteps.rejectedByTenantUserId))
        .leftJoin(rejectorUser, eq(rejectorUser.id, rejectorTu.userId))
        .where(eq(formResponseSteps.responseId, id))
        .orderBy(asc(formResponseSteps.sequence)),
      tx
        .select({ comment: formResponseComments, author: tenantUsers, account: user })
        .from(formResponseComments)
        .leftJoin(tenantUsers, eq(tenantUsers.id, formResponseComments.authorTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(formResponseComments.responseId, id))
        .orderBy(desc(formResponseComments.createdAt)),
      tx.select().from(formResponseScores).where(eq(formResponseScores.responseId, id)),
      // Show any CAPAs / incidents spawned from this response on the detail
      // page so the "Create CAPA" button is contextual ("Already spawned 2").
      tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
          status: correctiveActions.status,
          severity: correctiveActions.severity,
        })
        .from(correctiveActions)
        .where(eq(correctiveActions.sourceFormResponseId, id))
        .orderBy(desc(correctiveActions.createdAt)),
      tx
        .select({
          id: incidents.id,
          reference: incidents.reference,
          title: incidents.title,
          status: incidents.status,
        })
        .from(incidents)
        .where(eq(incidents.sourceFormResponseId, id))
        .orderBy(desc(incidents.reportedAt)),
      tx
        .select({
          id: formResponseCheckins.id,
          kind: formResponseCheckins.kind,
          recordedAt: formResponseCheckins.recordedAt,
          geoLat: formResponseCheckins.geoLat,
          geoLng: formResponseCheckins.geoLng,
          note: formResponseCheckins.note,
        })
        .from(formResponseCheckins)
        .where(eq(formResponseCheckins.responseId, id))
        .orderBy(desc(formResponseCheckins.recordedAt))
        .limit(20),
    ])
    // Loaders for the inline record editor (same shapes as the fill page) plus
    // the template's enabled manual-button flows for the configurable action bar.
    const [sites, allPeople, currentPersonRows, manualFlows] = await Promise.all([
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
        .orderBy(asc(orgUnits.name)),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName)),
      tx
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(eq(people.userId, ctx.userId ?? ''))
        .limit(1),
      tx
        .select({ id: formAutomations.id, graph: formAutomations.graph })
        .from(formAutomations)
        .where(
          and(eq(formAutomations.templateId, row.template.id), eq(formAutomations.enabled, true)),
        ),
    ])
    return {
      ...row,
      steps,
      comments,
      scoreRows,
      spawnedCAs,
      spawnedIncidents,
      checkins,
      sites,
      allPeople,
      currentPerson: currentPersonRows[0] ?? null,
      manualFlows,
    }
  })

  if (!data) notFound()
  // Per-user record visibility: read.all → any; read.site → my sites; else → ones I
  // submitted or am the subject of.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [data.response.submittedBy],
        personId: data.response.subjectPersonId,
        siteId: data.response.siteOrgUnitId,
      }),
    ))
  )
    notFound()
  const pendingFlowGates = await getPendingFlowGatesForSubject(
    ctx,
    'form_template',
    id,
    canManageSubjectGates(ctx, 'form_template', null),
  )
  const {
    response,
    template,
    version,
    steps,
    comments,
    scoreRows,
    spawnedCAs,
    spawnedIncidents,
    checkins,
    sites,
    allPeople,
    currentPerson,
    manualFlows,
  } = data

  // ---------- Record-page behaviour (lock + permissions) ----------
  // Mirrors the shape authored in the designer's Record tab.
  type RecordConfig = {
    locking?: {
      enabled?: boolean
      trigger?: string
      lockRoles?: string[]
      unlockRoles?: string[]
      autoLockOnFinalize?: boolean
    }
    tabs?: { review?: boolean; comments?: boolean; audit?: boolean }
  }
  const recordConfig = (template.recordConfig as RecordConfig | null) ?? null
  const locked = !!response.locked
  const userRoleKeys = await getUserRoleKeys(ctx)
  const canFillApp = appVisibleTo(ctx, template.allowedRoles, userRoleKeys)
  const recordValues = responsePayload(
    response.data ?? {},
    response.status === 'draft' || response.status === 'in_progress'
      ? (response.draftData as FormResponseDraftData | null)
      : null,
  )
  // Resolve picker-bound entity attributes so `entity_attr` formula fields
  // in the response editor show the same live values the filler did.
  // RLS-scoped via the request context.
  const entitiesByField = await loadEntitiesForPickers(ctx, version.schema, recordValues)
  const callerMembershipId = ctx.membership?.id ?? null
  const isOwner = response.submittedBy !== null && response.submittedBy === callerMembershipId
  const canWorkDraft =
    (response.status === 'draft' || response.status === 'in_progress') &&
    can(ctx, 'forms.response.create')
  const canEditRecord =
    canFillApp &&
    !locked &&
    (ctx.isSuperAdmin ||
      ctx.permissions.has('*') ||
      can(ctx, 'forms.response.read.all') ||
      (isOwner && (can(ctx, 'forms.response.update.own') || canWorkDraft)) ||
      (response.submittedBy === null && canWorkDraft))
  const canManageRecord =
    ctx.isSuperAdmin || ctx.permissions.has('*') || can(ctx, 'forms.response.read.all') || isOwner
  const lockRoles = recordConfig?.locking?.lockRoles
  const unlockRoles = recordConfig?.locking?.unlockRoles
  const canLockRecord =
    lockRoles && lockRoles.length > 0
      ? ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(userRoleKeys, lockRoles)
      : canManageRecord
  const canUnlockRecord =
    unlockRoles && unlockRoles.length > 0
      ? ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(userRoleKeys, unlockRoles)
      : canManageRecord

  // Record-page tab/review config — pending-review (compliance + sign-off),
  // Comments and Audit tabs are each toggleable per app. Sensible defaults keep
  // existing apps unchanged: review auto-enables only when the app scores items
  // or requires a signature, so a plain capture app (e.g. Lift Plan) shows no
  // "pending review" cruft.
  const hasSignatureStep = (version.schema.workflow?.steps ?? []).some((s) => s.signatureRequired)
  const reviewEnabled = recordConfig?.tabs?.review ?? (scoreRows.length > 0 || hasSignatureStep)
  const commentsEnabled = recordConfig?.tabs?.comments ?? true
  const auditEnabled = recordConfig?.tabs?.audit ?? true

  // ---------- Configurable record-action buttons ----------
  // Each enabled flow may expose one manual-trigger button. Keep a button only
  // when its authored permission/showIf gates pass for this user + record.
  const manualButtons: {
    flowId: string
    buttonId: string
    label: string
    icon?: string
    variant?: 'default' | 'outline' | 'destructive' | 'secondary'
    confirm?: string
    order: number
  }[] = []
  for (const flow of manualFlows) {
    for (const node of flow.graph.nodes) {
      if (node.data.kind !== 'trigger') continue
      const t = node.data.trigger
      if (t.trigger !== 'manual') continue
      if (t.requirePermission && !can(ctx, t.requirePermission)) continue
      if (
        t.showIf &&
        !evaluateLogicRule(t.showIf, { values: recordValues, rows: {}, entities: {} })
      )
        continue
      manualButtons.push({
        flowId: flow.id,
        buttonId: t.buttonId,
        label: t.label,
        icon: t.icon,
        variant: t.variant,
        confirm: t.confirm,
        order: t.order ?? 0,
      })
    }
  }
  manualButtons.sort((a, b) => a.order - b.order)

  const failCount = scoreRows.filter((r) => r.score === 0).length
  const passCount = scoreRows.filter((r) => r.score === 1).length

  // Re-run the score-router live against the persisted response data so the
  // "Failed checks" panel reflects the current schema (handles older
  // responses persisted before compliance columns existed). The persisted
  // complianceScore/Status remain authoritative when present.
  const evalRowsForScore: Record<string, Array<Record<string, unknown>>> = {}
  for (const sec of version.schema.sections) {
    if (!sec.repeating) continue
    const v = recordValues[sec.id]
    evalRowsForScore[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }
  const liveVerdict = computeFormScore(version.schema, recordValues, evalRowsForScore)
  const persistedScore = response.complianceScore != null ? Number(response.complianceScore) : null
  const complianceScore = persistedScore ?? liveVerdict.score
  const complianceStatus = response.complianceStatus ?? liveVerdict.status
  const failedFieldKeys = liveVerdict.failedFieldKeys
  const referenceShort = id.slice(0, 8)
  const spawnPrefill = buildSpawnPrefill({
    templateName: template.name,
    reference: referenceShort,
    score: complianceScore,
    schema: version.schema,
    values: recordValues,
    failedFieldKeys,
  })

  // Set by finalizeResponse when required-field validation blocks the finalize.
  const finalizeErrorCount = Number(pickString(sp.finalizeError) ?? '0')

  const drawerParam = pickString(sp.drawer)
  const openDrawer: SpawnDrawerKind =
    drawerParam === 'spawn-ca'
      ? 'spawn-ca'
      : drawerParam === 'spawn-incident'
        ? 'spawn-incident'
        : null

  // Build the workflow-panel input by joining the template's declared steps
  // with whatever state rows already exist. Steps the user hasn't touched yet
  // contribute a `pending` placeholder so the panel can show "Step 3 of 5".
  const templateWorkflowSteps: FormWorkflowStep[] = version.schema.workflow?.steps ?? []
  const stepsByKey = new Map(steps.map((row) => [row.step.stepKey, row]))
  const workflowStepProps: WorkflowStepProp[] = templateWorkflowSteps.map((wf, i) => {
    const joined = stepsByKey.get(wf.key)
    const row = joined?.step ?? null
    const signedByName =
      joined?.signerUser?.name ??
      joined?.signerTu?.displayName ??
      (joined?.signerPerson
        ? `${joined.signerPerson.firstName} ${joined.signerPerson.lastName}`
        : null)
    const rejectedByName = joined?.rejectorUser?.name ?? joined?.rejectorTu?.displayName ?? null
    const assigneeLabel =
      wf.assignee.type === 'literal'
        ? wf.assignee.userId
        : wf.assignee.type === 'role'
          ? wf.assignee.role
          : wf.assignee.expr
    return {
      key: wf.key,
      sequence: i,
      title: wf.title?.en ?? wf.key,
      signatureRequired: !!wf.signatureRequired,
      assigneeKind: wf.assignee.type,
      assigneeLabel,
      status: (row?.status ?? 'pending') as WorkflowStepProp['status'],
      signedAt: row?.signedAt ? row.signedAt.toISOString() : null,
      signedBy: signedByName,
      signatureDataUrl: row?.signatureDataUrl ?? null,
      comment: row?.comment ?? null,
      rejectionReason: row?.rejectionReason ?? null,
      rejectedAt: row?.rejectedAt ? row.rejectedAt.toISOString() : null,
      rejectedBy: rejectedByName,
    }
  })

  // The form's schema may declare needs-follow-up logic in metadata.
  const schemaMeta = (version.schema as any)?.metadata ?? {}
  const flagsFollowup = !!schemaMeta.needsFollowUpOnFail && failCount > 0

  const supportsReopen = response.status === 'closed' || response.status === 'rejected'

  const activity =
    active === 'audit' ? await recentActivityForEntity(ctx, 'form_response', id, 100) : []

  const basePath = `/apps/responses/${id}`
  const closeHref = `${basePath}${active === 'response' ? '' : `?tab=${active}`}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{
            href: `/apps/templates/${template.id}/records`,
            label: `Back to ${template.name}`,
          }}
          title={template.name}
          subtitle={`${id.slice(0, 8)} · v${version.version}`}
          badge={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  response.status === 'non_compliant'
                    ? 'destructive'
                    : response.status === 'closed' || response.status === 'submitted'
                      ? 'success'
                      : response.status === 'rejected'
                        ? 'destructive'
                        : 'warning'
                }
              >
                {response.status.replace('_', ' ')}
              </Badge>
              {reviewEnabled ? (
                <ComplianceBadge status={complianceStatus} score={complianceScore} />
              ) : null}
            </div>
          }
          actions={
            <>
              <Link
                href={`${basePath}?drawer=spawn-ca${active === 'response' ? '' : `&tab=${active}`}`}
              >
                <Button variant={complianceStatus === 'non_compliant' ? 'default' : 'outline'}>
                  <Plus size={14} /> Create CAPA
                </Button>
              </Link>
              <Link
                href={`${basePath}?drawer=spawn-incident${active === 'response' ? '' : `&tab=${active}`}`}
              >
                <Button variant="outline">
                  <ShieldAlert size={14} /> Create incident
                </Button>
              </Link>
              <RecordActionBar responseId={id} buttons={manualButtons} />
              {!locked ? (
                <>
                  {canEditRecord &&
                  (response.status === 'draft' || response.status === 'in_progress') ? (
                    <form action={finalizeResponse} className="inline">
                      <input type="hidden" name="responseId" value={id} />
                      <Button type="submit" variant="default">
                        <CheckCircle2 size={14} /> Finalize
                      </Button>
                    </form>
                  ) : null}
                  {canLockRecord ? (
                    <form action={lockResponse} className="inline">
                      <input type="hidden" name="responseId" value={id} />
                      <Button type="submit" variant="outline">
                        <Lock size={14} /> Lock
                      </Button>
                    </form>
                  ) : null}
                </>
              ) : canUnlockRecord ? (
                <form action={unlockResponse} className="inline">
                  <input type="hidden" name="responseId" value={id} />
                  <Button type="submit" variant="outline">
                    <LockOpen size={14} /> Unlock
                  </Button>
                </form>
              ) : null}
              {supportsReopen && canUnlockRecord ? (
                <form action={reopenResponse} className="inline">
                  <input type="hidden" name="responseId" value={id} />
                  <Button type="submit" variant="outline">
                    <Undo2 size={14} /> Reopen
                  </Button>
                </form>
              ) : null}
              <Link href={`/apps/responses/${id}/pdf`}>
                <Button variant="outline">
                  <FileText size={14} /> PDF
                </Button>
              </Link>
            </>
          }
        />
      }
      alerts={
        (reviewEnabled && (complianceStatus === 'non_compliant' || flagsFollowup)) ||
        finalizeErrorCount > 0 ||
        locked ||
        !canEditRecord ? (
          <div className="space-y-3">
            {finalizeErrorCount > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Record not finalized</AlertTitle>
                <AlertDescription>
                  {finalizeErrorCount} field{finalizeErrorCount === 1 ? ' is' : 's are'} incomplete
                  or invalid. Complete the required fields, then finalize again.
                </AlertDescription>
              </Alert>
            ) : null}
            {reviewEnabled && complianceStatus === 'non_compliant' ? (
              <Alert variant="destructive">
                <AlertTitle>Non-compliant response</AlertTitle>
                <AlertDescription>
                  Score {complianceScore.toFixed(1)} · {failedFieldKeys.length} failed check
                  {failedFieldKeys.length === 1 ? '' : 's'}. Spawn a corrective action to address
                  each failure.
                </AlertDescription>
              </Alert>
            ) : reviewEnabled && flagsFollowup ? (
              <Alert variant="warning">
                <AlertTitle>Follow-up required</AlertTitle>
                <AlertDescription>
                  This response has {failCount} failing item{failCount === 1 ? '' : 's'} and the
                  template is configured to require a corrective action.
                </AlertDescription>
              </Alert>
            ) : null}
            {locked ? (
              <Alert variant="warning">
                <AlertTitle>This entry is locked</AlertTitle>
                <AlertDescription>Unlock this entry before making field changes.</AlertDescription>
              </Alert>
            ) : !canEditRecord ? (
              <Alert variant="warning">
                <AlertTitle>View only</AlertTitle>
                <AlertDescription>
                  You can view this entry, but your current role cannot edit its fields.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'response', label: 'Response' },
            ...(commentsEnabled
              ? [{ key: 'comments', label: 'Comments', count: comments.length }]
              : []),
            ...(auditEnabled ? [{ key: 'audit', label: 'Audit trail' }] : []),
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'response' ? (
          <>
            {response.monitorStatus ? (
              <MonitorPanel
                responseId={response.id}
                monitorStatus={response.monitorStatus as MonitorStatus}
                nextCheckinDueAt={
                  response.nextCheckinDueAt ? response.nextCheckinDueAt.toISOString() : null
                }
                intervalMinutes={response.checkinIntervalMinutes}
                requireGeo={response.monitorRequireGeo ?? false}
                checkins={checkins.map((c) => ({
                  id: c.id,
                  kind: c.kind,
                  recordedAt: c.recordedAt.toISOString(),
                  geoLat: c.geoLat,
                  geoLng: c.geoLng,
                  note: c.note,
                }))}
              />
            ) : null}
            {reviewEnabled && failedFieldKeys.length > 0 ? (
              <Section
                title={`Failed checks (${failedFieldKeys.length})`}
                subtitle="Each can be turned into its own corrective action."
              >
                <ul className="space-y-2 text-sm">
                  {failedFieldKeys.map((key) => {
                    const label = labelForField(version.schema, key)
                    const raw = recordValues[key]
                    const displayValue =
                      raw == null
                        ? '—'
                        : typeof raw === 'string'
                          ? raw
                          : typeof raw === 'object' && raw && 'answer' in raw
                            ? String((raw as { answer?: string }).answer ?? '—')
                            : JSON.stringify(raw)
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-rose-900 dark:text-rose-200">
                            {label}
                          </div>
                          <div className="text-xs text-rose-700 dark:text-rose-300">
                            Answer: <strong>{displayValue}</strong>
                          </div>
                        </div>
                        <Link
                          href={`${basePath}?drawer=spawn-ca&failedField=${encodeURIComponent(key)}${active === 'response' ? '' : `&tab=${active}`}`}
                        >
                          <Button size="sm" variant="outline">
                            <Plus size={12} /> Create CAPA
                          </Button>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </Section>
            ) : null}

            {spawnedCAs.length > 0 || spawnedIncidents.length > 0 ? (
              <Section title="Spawned from this response">
                <div className="space-y-3 text-sm">
                  {spawnedCAs.length > 0 ? (
                    <div>
                      <div className="mb-1 text-xs tracking-wide text-slate-500 uppercase">
                        Corrective actions ({spawnedCAs.length})
                      </div>
                      <ul className="space-y-1.5">
                        {spawnedCAs.map((ca) => (
                          <li key={ca.id}>
                            <Link
                              href={`/corrective-actions/${ca.id}`}
                              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-slate-500">
                                  {ca.reference}
                                </span>
                                <span className="text-slate-900 dark:text-slate-100">
                                  {ca.title}
                                </span>
                              </span>
                              <Badge variant="secondary">{ca.status}</Badge>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {spawnedIncidents.length > 0 ? (
                    <div>
                      <div className="mb-1 text-xs tracking-wide text-slate-500 uppercase">
                        Incidents ({spawnedIncidents.length})
                      </div>
                      <ul className="space-y-1.5">
                        {spawnedIncidents.map((inc) => (
                          <li key={inc.id}>
                            <Link
                              href={`/incidents/${inc.id}`}
                              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-slate-500">
                                  {inc.reference}
                                </span>
                                <span className="text-slate-900 dark:text-slate-100">
                                  {inc.title}
                                </span>
                              </span>
                              <Badge variant="secondary">{inc.status}</Badge>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Section>
            ) : null}

            {reviewEnabled && scoreRows.length > 0 ? (
              <Section title="Compliance scoring">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge variant="success">{passCount} pass</Badge>
                  <Badge variant="destructive">{failCount} fail</Badge>
                  <Badge variant="secondary">
                    {scoreRows.length - passCount - failCount} n/a or rating
                  </Badge>
                  <span className="text-slate-500">{scoreRows.length} scored items total</span>
                </div>
              </Section>
            ) : null}

            {(() => {
              const initialRows: Record<string, Array<Record<string, unknown>>> = {}
              for (const sec of version.schema.sections) {
                const rows = recordValues[sec.id]
                if (sec.repeating && Array.isArray(rows)) {
                  initialRows[sec.id] = rows as Array<Record<string, unknown>>
                }
              }
              return (
                <FormRenderer
                  inlineAutosave
                  readOnly={!canEditRecord}
                  templateId={template.id}
                  templateName={template.name}
                  version={version.version}
                  schema={version.schema}
                  sites={sites}
                  people={allPeople}
                  entitiesByField={entitiesByField}
                  currentUser={{
                    personId: currentPerson?.id ?? null,
                    name: currentPerson
                      ? `${currentPerson.firstName} ${currentPerson.lastName}`
                      : (ctx.membership?.displayName ?? null),
                  }}
                  initialResponseId={id}
                  initialValues={recordValues}
                  initialRows={initialRows}
                  initialStepIndex={0}
                  isResumed={false}
                  returnTo={null}
                  responseStatus={response.status}
                />
              )
            })()}

            {pendingFlowGates.length > 0 ? <FlowApprovals gates={pendingFlowGates} /> : null}

            {reviewEnabled ? (
              <Section
                title={`Workflow steps (${workflowStepProps.length})`}
                defaultOpen={workflowStepProps.length > 0}
              >
                {workflowStepProps.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No workflow steps configured on this template.
                  </p>
                ) : (
                  <WorkflowPanel
                    responseId={id}
                    steps={workflowStepProps}
                    currentStepKey={response.currentStep ?? null}
                    responseStatus={response.status}
                    // canAct = a user is signed in to this tenant. The panel itself
                    // disables interaction when the response is in a terminal
                    // (closed/rejected) state. Super-admin viewing-as has
                    // membership=null but ctx-level permissions; we still allow
                    // them to interact for cross-tenant debugging.
                    canAct={true}
                  />
                )}
              </Section>
            ) : null}
          </>
        ) : null}

        {active === 'comments' && commentsEnabled ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Comments ({comments.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {comments.length === 0 ? (
                  <EmptyState
                    icon={<MessageSquare size={24} />}
                    title="No comments"
                    description="Discussion between reviewers and submitters, follow-up notes, and correction history."
                  />
                ) : (
                  <ul className="space-y-3 text-sm">
                    {comments.map((c) => (
                      <li
                        key={c.comment.id}
                        className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {c.account?.name ?? c.author?.displayName ?? 'Someone'}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(c.comment.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                          {c.comment.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Section title="Add a comment">
              <form action={addComment} className="space-y-3">
                <input type="hidden" name="responseId" value={id} />
                <Textarea name="body" rows={3} required placeholder="Type a comment…" />
                <div className="flex justify-end">
                  <Button type="submit">
                    <Send size={14} /> Post comment
                  </Button>
                </div>
              </form>
            </Section>
          </div>
        ) : null}

        {active === 'audit' && auditEnabled ? (
          <Card>
            <CardHeader>
              <CardTitle>Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <SpawnDrawers
        responseId={id}
        openDrawer={openDrawer}
        closeHref={closeHref}
        prefill={
          // Per-field CAPA spawn — recompute prefill scoped to the single
          // failed field referenced in `?failedField=`. Cheap; runs once
          // per render.
          (() => {
            const single = pickString(sp.failedField)
            if (!single || !failedFieldKeys.includes(single)) return spawnPrefill
            return buildSpawnPrefill({
              templateName: template.name,
              reference: referenceShort,
              score: complianceScore,
              schema: version.schema,
              values: recordValues,
              failedFieldKeys,
              singleFailedFieldKey: single,
            })
          })()
        }
        spawnCa={createCorrectiveActionFromResponse}
        spawnIncident={createIncidentFromResponse}
      />
    </DetailPageLayout>
  )
}

// Visual chip that mirrors the persisted complianceStatus + score.
// Rendered in the page header alongside the workflow-status badge.
function ComplianceBadge({
  status,
  score,
}: {
  status: 'compliant' | 'non_compliant' | 'pending_review'
  score: number
}) {
  if (status === 'compliant') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
        <CheckCircle2 size={12} /> Compliant · {score.toFixed(0)}%
      </span>
    )
  }
  if (status === 'non_compliant') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900">
        <AlertTriangle size={12} /> Non-compliant · {score.toFixed(0)}%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
      <Clock size={12} /> Pending review
    </span>
  )
}
