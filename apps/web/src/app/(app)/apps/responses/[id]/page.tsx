import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { aliasedTable, and, asc, desc, eq } from 'drizzle-orm'
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
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import {
  entityDisplayName,
  evaluateFormulaTree,
  evaluateLogicRule,
  sanitizeDocumentHtml,
  type EvalContext,
  type FormulaExpression,
  type TableColumn,
  type TableConfig,
} from '@beaconhs/forms-core'
import { loadEntitiesForPickers, type EntitiesByField } from '@/app/(app)/apps/_lib/entity-loader'
import { canvasCss, columnsCss, gridClass, resolveCanvas } from '@/app/(app)/apps/_lib/canvas'
import type { AttachedFile } from '@/components/file-upload'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
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
      .where(eq(formResponses.id, id))
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
        .where(eq(orgUnits.level, 'site'))
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
    site,
    subjectPerson,
    submitterAccount,
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

  // Resolve picker-bound entity attributes so `entity_attr` formula fields
  // in the response viewer show the same live values the filler did.
  // RLS-scoped via the request context.
  const entitiesByField = await loadEntitiesForPickers(ctx, version.schema, response.data)

  // ---------- Record-page behaviour (editing mode + lock) ----------
  // Mirrors the shape authored in the designer's Record tab.
  type RecordConfig = {
    editingMode?: 'guided_fill' | 'inline_record' | 'both'
    locking?: {
      enabled?: boolean
      trigger?: string
      lockRoles?: string[]
      unlockRoles?: string[]
      autoLockOnFinalize?: boolean
    }
  }
  const recordConfig = (template.recordConfig as RecordConfig | null) ?? null
  // Inline-record editing is the default for non-wizard, non-checklist apps;
  // wizards/checklists keep the guided fill flow unless explicitly overridden.
  const defaultInline = template.kind !== 'wizard' && template.kind !== 'checklist'
  const editingMode = recordConfig?.editingMode ?? (defaultInline ? 'inline_record' : 'guided_fill')
  const inlineMode = editingMode === 'inline_record' || editingMode === 'both'
  const locked = !!response.locked
  const userRoleKeys = await getUserRoleKeys(ctx)
  const canFillApp = appVisibleTo(ctx, template.allowedRoles, userRoleKeys)

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
        !evaluateLogicRule(t.showIf, { values: response.data, rows: {}, entities: {} })
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
    const v = response.data[sec.id]
    evalRowsForScore[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }
  const liveVerdict = computeFormScore(version.schema, response.data, evalRowsForScore)
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
    values: response.data,
    failedFieldKeys,
  })

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
              <ComplianceBadge status={complianceStatus} score={complianceScore} />
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
                  {response.status === 'draft' || response.status === 'in_progress' ? (
                    <form action={finalizeResponse} className="inline">
                      <input type="hidden" name="responseId" value={id} />
                      <Button type="submit" variant="default">
                        <CheckCircle2 size={14} /> Finalize
                      </Button>
                    </form>
                  ) : null}
                  <form action={lockResponse} className="inline">
                    <input type="hidden" name="responseId" value={id} />
                    <Button type="submit" variant="outline">
                      <Lock size={14} /> Lock
                    </Button>
                  </form>
                </>
              ) : (
                <form action={unlockResponse} className="inline">
                  <input type="hidden" name="responseId" value={id} />
                  <Button type="submit" variant="outline">
                    <LockOpen size={14} /> Unlock
                  </Button>
                </form>
              )}
              {supportsReopen ? (
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
        complianceStatus === 'non_compliant' ? (
          <Alert variant="destructive">
            <AlertTitle>Non-compliant response</AlertTitle>
            <AlertDescription>
              Score {complianceScore.toFixed(1)} · {failedFieldKeys.length} failed check
              {failedFieldKeys.length === 1 ? '' : 's'}. Spawn a corrective action to address each
              failure.
            </AlertDescription>
          </Alert>
        ) : flagsFollowup ? (
          <Alert variant="warning">
            <AlertTitle>Follow-up required</AlertTitle>
            <AlertDescription>
              This response has {failCount} failing item{failCount === 1 ? '' : 's'} and the
              template is configured to require a corrective action.
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
            { key: 'response', label: 'Response' },
            { key: 'comments', label: 'Comments', count: comments.length },
            { key: 'audit', label: 'Audit trail' },
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
            <Section title="Overview">
              <DetailGrid
                rows={[
                  {
                    label: 'Template',
                    value: (
                      <Link
                        href={`/apps/templates/${template.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {template.name}
                      </Link>
                    ),
                  },
                  { label: 'Template version', value: `v${version.version}` },
                  { label: 'Status', value: response.status.replace('_', ' ') },
                  { label: 'Current step', value: response.currentStep ?? '—' },
                  { label: 'Site', value: site?.name ?? '—' },
                  {
                    label: 'Subject',
                    value: subjectPerson
                      ? `${subjectPerson.firstName} ${subjectPerson.lastName}`
                      : '—',
                  },
                  { label: 'Submitted by', value: submitterAccount?.name ?? '—' },
                  {
                    label: 'Submitted at',
                    value: response.submittedAt
                      ? new Date(response.submittedAt).toLocaleString()
                      : '—',
                  },
                  {
                    label: 'Closed at',
                    value: response.closedAt ? new Date(response.closedAt).toLocaleString() : '—',
                  },
                ]}
              />
            </Section>

            {failedFieldKeys.length > 0 ? (
              <Section
                title={`Failed checks (${failedFieldKeys.length})`}
                subtitle="Each can be turned into its own corrective action."
              >
                <ul className="space-y-2 text-sm">
                  {failedFieldKeys.map((key) => {
                    const label = labelForField(version.schema, key)
                    const raw = response.data[key]
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
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-rose-900">{label}</div>
                          <div className="text-xs text-rose-700">
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
                              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-slate-500">
                                  {ca.reference}
                                </span>
                                <span className="text-slate-900">{ca.title}</span>
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
                              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-slate-500">
                                  {inc.reference}
                                </span>
                                <span className="text-slate-900">{inc.title}</span>
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

            {scoreRows.length > 0 ? (
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

            {inlineMode ? (
              // Inline record editing (native LiveField parity): every section
              // renders as a vertical stack of self-autosaving fields. Locked or
              // view-only records render the same surface, read-only.
              (() => {
                const initialRows: Record<string, Array<Record<string, unknown>>> = {}
                for (const sec of version.schema.sections) {
                  const rows = response.data?.[sec.id]
                  if (sec.repeating && Array.isArray(rows)) {
                    initialRows[sec.id] = rows as Array<Record<string, unknown>>
                  }
                }
                return (
                  <FormRenderer
                    inlineAutosave
                    readOnly={locked || !canFillApp}
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
                    initialValues={response.data}
                    initialRows={initialRows}
                    initialStepIndex={0}
                    isResumed={false}
                    returnTo={null}
                    responseStatus={response.status}
                  />
                )
              })()
            ) : (
              <>
                {canFillApp && !locked ? (
                  <div className="flex justify-end">
                    <Link href={`/apps/templates/${template.id}/fill?responseId=${id}`}>
                      <Button variant="outline">
                        <FileText size={14} /> Open in form
                      </Button>
                    </Link>
                  </div>
                ) : null}
                {(() => {
                  // Build a shared eval context once for the entire response page.
                  // Repeating-section row arrays are hoisted out of `data` into
                  // `ctx.rows` so cross-section formulas (sum_section) resolve.
                  const rows: Record<string, Array<Record<string, unknown>>> = {}
                  for (const sec of version.schema.sections) {
                    if (!sec.repeating) continue
                    const v = response.data[sec.id]
                    rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
                  }
                  const evalCtx: EvalContext = {
                    values: response.data,
                    rows,
                    entities: entitiesByField,
                  }
                  return version.schema.sections.map((sec) => {
                    // Section-level conditional visibility — skip entirely if false.
                    if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return null
                    return (
                      <Section
                        key={sec.id}
                        title={sec.title?.en ?? sec.id}
                        subtitle={sec.repeating ? 'repeating section' : undefined}
                      >
                        {sec.repeating
                          ? renderRepeating(sec, response.data, evalCtx)
                          : renderFlat(sec, response.data, evalCtx)}
                      </Section>
                    )
                  })
                })()}
              </>
            )}

            {pendingFlowGates.length > 0 ? <FlowApprovals gates={pendingFlowGates} /> : null}

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
          </>
        ) : null}

        {active === 'comments' ? (
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
                        className="rounded-md border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {c.account?.name ?? c.author?.displayName ?? 'Someone'}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(c.comment.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-slate-800">{c.comment.body}</p>
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

        {active === 'audit' ? (
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
              values: response.data,
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
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
        <CheckCircle2 size={12} /> Compliant · {score.toFixed(0)}%
      </span>
    )
  }
  if (status === 'non_compliant') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
        <AlertTriangle size={12} /> Non-compliant · {score.toFixed(0)}%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
      <Clock size={12} /> Pending review
    </span>
  )
}

function renderFlat(sec: any, values: Record<string, unknown>, evalCtx: EvalContext) {
  if (sec.fields.length === 0) return <p className="text-sm text-slate-500">No fields.</p>
  const visible = sec.fields.filter((f: any) => !f.showIf || evaluateLogicRule(f.showIf, evalCtx))
  if (visible.length === 0) {
    return (
      <p className="text-sm text-slate-500">All fields in this section are conditionally hidden.</p>
    )
  }

  // A single field's label/value cell — reused across all layout modes.
  const cell = (f: any) => {
    let raw: unknown = values[f.id]
    if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
      raw = evaluateFormulaTree(f.formula as FormulaExpression, evalCtx)
    }
    return (
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs tracking-wide text-slate-500 uppercase">{f.label?.en ?? f.id}</dt>
        <dd className="text-slate-900">{renderValue(f, raw, evalCtx.entities)}</dd>
      </div>
    )
  }

  // Free-form canvas (mobile-first: stacks on phones, positioned grid on ≥640px).
  if (sec.canvas) {
    const cls = gridClass(sec.id)
    const { order, byId } = resolveCanvas(
      visible.map((f: any) => f.id),
      sec.canvas.items,
      sec.canvas.cols,
    )
    const byField = new Map(visible.map((f: any) => [f.id, f]))
    return (
      <dl className={cls}>
        <style>{canvasCss(cls, sec.canvas.cols, sec.canvas.rowHeight, byId)}</style>
        {order.map((id) => (
          <div key={id} data-ci={id}>
            {cell(byField.get(id))}
          </div>
        ))}
      </dl>
    )
  }

  // Column layout (mobile-first: single column on phones, N columns on ≥640px).
  if (sec.layout?.columns && sec.layout.columns > 1) {
    const cls = gridClass(sec.id)
    const cols = sec.layout.columns
    const css = columnsCss(
      cls,
      cols,
      visible.map((f: any) => ({ id: f.id, span: f.colSpan ?? cols })),
    )
    return (
      <dl className={cls}>
        <style>{css}</style>
        {visible.map((f: any) => (
          <div key={f.id} data-cs={f.id}>
            {cell(f)}
          </div>
        ))}
      </dl>
    )
  }

  // Default: responsive 2-column grid.
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {visible.map((f: any) => (
        <div key={f.id}>{cell(f)}</div>
      ))}
    </dl>
  )
}

function renderRepeating(sec: any, values: Record<string, unknown>, evalCtx: EvalContext) {
  const rows = (values[sec.id] as Array<Record<string, unknown>> | undefined) ?? []
  if (rows.length === 0) return <p className="text-sm text-slate-500">No rows recorded.</p>
  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        // Per-row eval context so showIf inside the row can reference siblings.
        const rowCtx: EvalContext = { ...evalCtx, values: { ...evalCtx.values, ...row } }
        return (
          <li key={i} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-xs tracking-wide text-slate-500 uppercase">Row {i + 1}</div>
            {renderFlat(sec, row, rowCtx)}
          </li>
        )
      })}
    </ul>
  )
}

function renderValue(
  field: {
    id: string
    type: string
    config?: Record<string, unknown>
    validation?: { options?: { value: string; label?: { en?: string } }[] }
  },
  raw: unknown,
  entities?: EntitiesByField,
) {
  const type = field.type
  // Metric blocks are display-only (live aggregates) — nothing is stored.
  if (type === 'metric') return <span className="text-slate-400 italic">live metric</span>
  if (raw === undefined || raw === null || raw === '') {
    return <span className="text-slate-400">—</span>
  }
  switch (type) {
    case 'yes_no_comment': {
      const v = raw as { answer?: string; comment?: string }
      return (
        <span>
          <strong>{v.answer ?? '—'}</strong>
          {v.comment ? <span className="ml-2 text-slate-500">— {v.comment}</span> : null}
        </span>
      )
    }
    case 'gps': {
      const v = raw as { lat?: number; lng?: number; accuracy?: number }
      if (typeof v.lat !== 'number' || typeof v.lng !== 'number')
        return <span className="text-slate-400">—</span>
      return (
        <a
          href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-teal-700 hover:underline"
        >
          {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
          {v.accuracy ? ` (±${Math.round(v.accuracy)}m)` : ''}
        </a>
      )
    }
    case 'matrix': {
      const v = raw as Record<string, string>
      const rows = (field.config?.rows as { key: string; label: string }[] | undefined) ?? []
      const scale = (field.config?.scale as { value: string; label: string }[] | undefined) ?? []
      const scaleLabel = (val: string) => scale.find((s) => s.value === val)?.label ?? val
      const entries = rows.length
        ? rows.filter((r) => v[r.key]).map((r) => [r.label, v[r.key]!] as const)
        : Object.entries(v)
      if (entries.length === 0) return <span className="text-slate-400">—</span>
      return (
        <ul className="space-y-0.5 text-sm">
          {entries.map(([label, val]) => (
            <li key={label}>
              <span className="text-slate-500">{label}:</span> <strong>{scaleLabel(val)}</strong>
            </li>
          ))}
        </ul>
      )
    }
    case 'lookup':
      // Stored value is the bound source's value column (a label or stable id).
      return <span className="text-slate-900">{String(raw)}</span>
    case 'data_table': {
      const ids = Array.isArray(raw) ? (raw as string[]) : []
      if (ids.length === 0) return <span className="text-slate-400">—</span>
      return (
        <span className="text-slate-700">
          {ids.length} record{ids.length === 1 ? '' : 's'} selected
        </span>
      )
    }
    case 'photo_ai': {
      const val = raw as {
        attachments?: { url?: string; filename?: string }[]
        analysis?: {
          summary?: string
          overallRisk?: string
          ppe?: { item: string; status: string }[]
          hazards?: { type: string; severity: string; detail: string }[]
        }
      }
      const a = val.analysis
      const n = val.attachments?.length ?? 0
      const badPpe = (a?.ppe ?? []).filter((p) => p.status !== 'present')
      return (
        <div className="space-y-1 text-sm">
          <div className="text-xs text-slate-500">
            {n} photo{n === 1 ? '' : 's'}
            {a ? (
              <>
                {' '}
                · risk <strong className="text-slate-700">{a.overallRisk}</strong>
              </>
            ) : null}
          </div>
          {a?.summary ? <p className="text-slate-600">{a.summary}</p> : null}
          {a?.hazards?.length ? (
            <p className="text-slate-700">
              <span className="text-slate-500">Hazards:</span>{' '}
              {a.hazards.map((h) => `${h.type} (${h.severity})`).join(', ')}
            </p>
          ) : null}
          {badPpe.length ? (
            <p className="text-slate-700">
              <span className="text-slate-500">Missing/incorrect PPE:</span>{' '}
              {badPpe.map((p) => p.item).join(', ')}
            </p>
          ) : null}
          {!a ? <span className="text-slate-400">not analysed</span> : null}
        </div>
      )
    }
    case 'qr_scanner':
      return <span className="font-mono text-sm text-slate-800">{String(raw)}</span>
    case 'ranking': {
      const order = Array.isArray(raw) ? (raw as string[]) : []
      if (order.length === 0) return <span className="text-slate-400">—</span>
      const opts = field.validation?.options ?? []
      const labelOf = (v: string) => opts.find((o) => o.value === v)?.label?.en ?? v
      return (
        <ol className="space-y-0.5 text-sm">
          {order.map((v, i) => (
            <li key={v}>
              <span className="text-slate-400">{i + 1}.</span>{' '}
              <span className="text-slate-700">{labelOf(v)}</span>
            </li>
          ))}
        </ol>
      )
    }
    case 'rich_text':
      return (
        <div
          className="prose prose-sm max-w-none text-slate-700"
          dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(String(raw)) }}
        />
      )
    case 'address': {
      const a = raw as {
        line1?: string
        city?: string
        region?: string
        postal?: string
        country?: string
        lat?: number
        lng?: number
        query?: string
      }
      const lines = [
        a.line1,
        [a.city, a.region, a.postal].filter(Boolean).join(', '),
        a.country,
      ].filter(Boolean)
      if (lines.length === 0 && !a.query) return <span className="text-slate-400">—</span>
      return (
        <div className="text-sm text-slate-700">
          {lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <div>{a.query}</div>}
          {typeof a.lat === 'number' && typeof a.lng === 'number' ? (
            <a
              href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-teal-700 hover:underline"
            >
              View on map
            </a>
          ) : null}
        </div>
      )
    }
    case 'photo_annotated': {
      const val = raw as {
        attachments?: { url?: string }[]
        markers?: { x: number; y: number; label: string }[]
      }
      const url = val.attachments?.[0]?.url
      const markers = Array.isArray(val.markers) ? val.markers : []
      return (
        <div className="space-y-1.5 text-sm">
          {url ? (
            <div className="relative inline-block max-w-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Annotated hazards"
                className="max-h-64 max-w-full rounded border border-slate-200"
              />
              {markers.map((m, i) => (
                <span
                  key={i}
                  className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white ring-2 ring-white"
                  style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-400">{val.attachments?.length ?? 0} photo(s)</span>
          )}
          {markers.length > 0 ? (
            <ol className="space-y-0.5">
              {markers.map((m, i) => (
                <li key={i} className="text-slate-700">
                  <span className="font-semibold text-rose-600">{i + 1}.</span>{' '}
                  {m.label || <span className="text-slate-400">(no note)</span>}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )
    }
    case 'signature': {
      const sig = raw as { url?: string } | string
      const url = typeof sig === 'object' && sig ? sig.url : undefined
      return url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Signature"
          className="h-16 w-auto rounded border border-slate-200 bg-white"
        />
      ) : (
        <span className="text-slate-500">[signature captured]</span>
      )
    }
    case 'sketch': {
      const sk = raw as { url?: string } | string
      const url = typeof sk === 'object' && sk ? sk.url : undefined
      return url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Diagram"
          className="max-h-80 w-auto rounded border border-slate-200 bg-white"
        />
      ) : (
        <span className="text-slate-500">[diagram captured]</span>
      )
    }
    case 'photo':
    case 'photo_upload': {
      const files = Array.isArray(raw) ? (raw as AttachedFile[]) : []
      if (files.length === 0) return <span className="text-slate-400">—</span>
      return (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <a
              key={f.attachmentId ?? i}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              title={f.filename}
              className="block h-20 w-20 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.filename ?? 'photo'} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )
    }
    case 'file':
    case 'video':
    case 'audio': {
      const files = Array.isArray(raw) ? (raw as AttachedFile[]) : []
      if (files.length === 0) return <span className="text-slate-400">—</span>
      return (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={f.attachmentId ?? i}>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-teal-700 hover:underline"
              >
                {f.filename ?? 'attachment'}
              </a>
            </li>
          ))}
        </ul>
      )
    }
    case 'person_picker':
    case 'customer_picker':
    case 'site_picker':
    case 'project_picker':
    case 'area_picker':
    case 'equipment_picker':
    case 'ppe_picker':
    case 'document_picker':
    case 'course_picker': {
      const name = entityDisplayName(entities?.[field.id])
      if (name) return name
      return typeof raw === 'string' ? raw.slice(0, 8) : String(raw)
    }
    case 'multi_person_picker':
      return Array.isArray(raw)
        ? raw.map((v) => String(v).slice(0, 8)).join(', ')
        : String(raw).slice(0, 8)
    case 'table':
      return renderTableValue(field.config, raw)
    case 'checkbox_group':
    case 'multi_select':
      return Array.isArray(raw) ? raw.map((v) => String(v)).join(', ') : String(raw)
    default:
      return String(raw)
  }
}

function renderTableValue(rawConfig: Record<string, unknown> | undefined, raw: unknown) {
  const cfg = (rawConfig ?? {}) as Partial<TableConfig>
  const columns = (cfg.columns ?? []) as TableColumn[]
  const fixedRows = cfg.rows ?? []
  const rowMode = cfg.rowMode === 'fixed' ? 'fixed' : 'addable'
  const stored = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  const rows = rowMode === 'fixed' ? fixedRows.map((_, i) => stored[i] ?? {}) : stored
  if (columns.length === 0 || rows.length === 0) {
    return <span className="text-slate-400">—</span>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            {rowMode === 'fixed' ? (
              <th className="border-b border-slate-200 px-2 py-1 text-left text-xs font-semibold text-slate-600" />
            ) : null}
            {columns.map((c) => (
              <th
                key={c.key}
                className="border-b border-slate-200 px-2 py-1 text-left text-xs font-semibold text-slate-600"
              >
                {c.label || c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-b-0">
              {rowMode === 'fixed' ? (
                <td className="px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-700">
                  {fixedRows[i]?.label ?? `Row ${i + 1}`}
                </td>
              ) : null}
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1 text-slate-800">
                  {formatTableCellValue(c, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatTableCellValue(column: TableColumn, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (column.type === 'checkbox') return value ? '✓' : '—'
  if (column.type === 'select') {
    const opt = (column.options ?? []).find((o) => o.value === value)
    return opt?.label ?? String(value)
  }
  return String(value)
}
