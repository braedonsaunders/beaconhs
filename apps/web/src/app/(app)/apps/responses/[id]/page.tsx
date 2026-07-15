import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { aliasedTable, and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  LockOpen,
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
  DetailHeader,
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
  users as user,
  type FormResponseDraftData,
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import { evaluateLogicRule } from '@beaconhs/forms-core'
import { localizeText } from '@beaconhs/i18n'
import { loadEntitiesForPickers } from '@/app/(app)/apps/_lib/entity-loader'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'
import { requireRequestContext } from '@/lib/auth'
import { attachmentUrl } from '@/lib/attachment-url'
import { canSeeRecord, moduleScopeWhere } from '@/lib/visibility'
import { activityPageForEntity, recordAuditInTransaction } from '@/lib/audit'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { isUuid, pickString } from '@/lib/list-params'
import { WorkflowPanel, type WorkflowStepProp } from './_workflow-panel'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { createCorrectiveActionFromResponse, createIncidentFromResponse } from './_spawn-actions'
import { buildSpawnPrefill, displayValueForField, labelForField } from './_spawn-prefill'
import { SpawnDrawers, type SpawnDrawerKind } from './_spawn-drawers'
import { MonitorPanel, type MonitorStatus } from './_monitor-panel'
import { can } from '@beaconhs/tenant'
import {
  canAccessResponseTemplate,
  canAccessTemplate,
  canEditResponsePayload,
} from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { FormRenderer } from '@/app/(app)/apps/templates/[id]/fill/form-renderer'
import {
  finalizeResponse,
  lockResponse,
  reopenResponse,
  unlockResponse,
} from './_lifecycle-actions'
import { RecordActionBar } from './_record-action-bar'
import { parseResponseDetailListState } from './_detail-list-state'
import {
  AuditTrailPanel,
  CheckinHistory,
  CommentsPanel,
  SpawnedRecordsSection,
} from './_detail-lists'

export const dynamic = 'force-dynamic'

const TABS = ['response', 'comments', 'audit'] as const
type Tab = (typeof TABS)[number]

function hasAnyRole(roleKeys: ReadonlySet<string>, allowed: string[] | null | undefined): boolean {
  return !!allowed && allowed.length > 0 && allowed.some((r) => roleKeys.has(r))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0c7bbc8397f253', { value0: id.slice(0, 8) }) }
}

// ---------- Server actions ----------

async function addComment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!isUuid(responseId) || !body || body.length > 10_000) return
  if (!ctx.membership?.id) return
  if (!(await canAccessResponseTemplate(ctx, responseId, 'operate'))) return
  // Per-user record visibility re-check: the page render is scoped, but this
  // action is reachable directly, so a user must be able to see the response
  // before commenting on it (read.all → any; read.site → my sites; else → mine).
  const added = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        submittedBy: formResponses.submittedBy,
        subjectPersonId: formResponses.subjectPersonId,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
      .limit(1)
    if (!r) return false
    if (
      !(await canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [r.submittedBy],
        personId: r.subjectPersonId,
        siteId: r.siteOrgUnitId,
      }))
    ) {
      return false
    }
    await tx.insert(formResponseComments).values({
      tenantId: ctx.tenantId,
      responseId,
      authorTenantUserId: ctx.membership!.id,
      body,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_response',
      entityId: responseId,
      action: 'update',
      summary: 'Comment added',
    })
    return true
  })
  if (!added) return
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'response')
  const listState = parseResponseDetailListState(sp)

  const ctx = await requireRequestContext()
  if (!(await canAccessResponseTemplate(ctx, id, 'browse-records'))) notFound()
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)
  const baseData = await ctx.db(async (tx) => {
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
    return row ?? null
  })

  if (!baseData) notFound()
  // Enforce record visibility before loading any child history or linked
  // module records. RLS bounds the tenant; this guard applies the user's
  // all/site/self tier within that tenant.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [baseData.response.submittedBy],
        personId: baseData.response.subjectPersonId,
        siteId: baseData.response.siteOrgUnitId,
      }),
    ))
  )
    notFound()

  const detailData = await ctx.db(async (tx) => {
    // Aliased joins so we can attach signer + rejector display names to each
    // step row in a single query.
    const signerTu = aliasedTable(tenantUsers, 'signer_tu')
    const signerUser = aliasedTable(user, 'signer_user')
    const signerPerson = aliasedTable(people, 'signer_person')
    const rejectorTu = aliasedTable(tenantUsers, 'rejector_tu')
    const rejectorUser = aliasedTable(user, 'rejector_user')

    const [steps, scoreRows, commentTotalRows] = await Promise.all([
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
      tx.select().from(formResponseScores).where(eq(formResponseScores.responseId, id)),
      tx
        .select({ count: count() })
        .from(formResponseComments)
        .where(eq(formResponseComments.responseId, id)),
    ])

    const comments = await (async () => {
      if (active !== 'comments') {
        return { rows: [], filteredTotal: 0 }
      }
      const where = and(
        eq(formResponseComments.responseId, id),
        listState.comments.q
          ? or(
              ilike(formResponseComments.body, `%${listState.comments.q}%`),
              ilike(tenantUsers.displayName, `%${listState.comments.q}%`),
              ilike(user.name, `%${listState.comments.q}%`),
            )
          : undefined,
      )
      const [filteredRows, rows] = await Promise.all([
        tx
          .select({ count: count() })
          .from(formResponseComments)
          .leftJoin(tenantUsers, eq(tenantUsers.id, formResponseComments.authorTenantUserId))
          .leftJoin(user, eq(user.id, tenantUsers.userId))
          .where(where),
        tx
          .select({ comment: formResponseComments, author: tenantUsers, account: user })
          .from(formResponseComments)
          .leftJoin(tenantUsers, eq(tenantUsers.id, formResponseComments.authorTenantUserId))
          .leftJoin(user, eq(user.id, tenantUsers.userId))
          .where(where)
          .orderBy(
            listState.comments.sort === 'oldest'
              ? asc(formResponseComments.createdAt)
              : desc(formResponseComments.createdAt),
            listState.comments.sort === 'oldest'
              ? asc(formResponseComments.id)
              : desc(formResponseComments.id),
          )
          .limit(listState.comments.perPage)
          .offset((listState.comments.page - 1) * listState.comments.perPage),
      ])
      return {
        rows: rows.map(({ comment, author, account }) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          authorName: account?.name ?? author?.displayName ?? null,
        })),
        filteredTotal: Number(filteredRows[0]?.count ?? 0),
      }
    })()

    const spawned = await (async () => {
      if (active !== 'response') {
        return {
          correctiveActions: {
            rows: [] as { id: string; reference: string; title: string; status: string }[],
            total: 0,
            filteredTotal: 0,
          },
          incidents: {
            rows: [] as { id: string; reference: string; title: string; status: string }[],
            total: 0,
            filteredTotal: 0,
          },
          checkins: {
            rows: [] as {
              id: string
              kind: string
              recordedAt: Date
              geoLat: number | null
              geoLng: number | null
              note: string | null
            }[],
            total: 0,
            filteredTotal: 0,
          },
        }
      }

      const [caVisibility, incidentVisibility] = await Promise.all([
        moduleScopeWhere(ctx, tx, {
          prefix: 'ca',
          ownerCols: [correctiveActions.ownerTenantUserId],
          siteCol: correctiveActions.siteOrgUnitId,
        }),
        moduleScopeWhere(ctx, tx, {
          prefix: 'incidents',
          ownerCols: [incidents.reportedByTenantUserId],
          siteCol: incidents.siteOrgUnitId,
        }),
      ])
      const caBaseWhere = and(
        eq(correctiveActions.sourceFormResponseId, id),
        eq(correctiveActions.isDraft, false),
        isNull(correctiveActions.deletedAt),
        caVisibility,
      )
      const caWhere = and(
        caBaseWhere,
        listState.correctiveActions.q
          ? or(
              ilike(correctiveActions.reference, `%${listState.correctiveActions.q}%`),
              ilike(correctiveActions.title, `%${listState.correctiveActions.q}%`),
            )
          : undefined,
        listState.correctiveActions.status
          ? eq(correctiveActions.status, listState.correctiveActions.status)
          : undefined,
      )
      const incidentBaseWhere = and(
        eq(incidents.sourceFormResponseId, id),
        eq(incidents.isDraft, false),
        isNull(incidents.deletedAt),
        incidentVisibility,
      )
      const incidentWhere = and(
        incidentBaseWhere,
        listState.incidents.q
          ? or(
              ilike(incidents.reference, `%${listState.incidents.q}%`),
              ilike(incidents.title, `%${listState.incidents.q}%`),
            )
          : undefined,
        listState.incidents.status ? eq(incidents.status, listState.incidents.status) : undefined,
      )
      const checkinBaseWhere = eq(formResponseCheckins.responseId, id)
      const checkinWhere = and(
        checkinBaseWhere,
        listState.checkins.q
          ? ilike(formResponseCheckins.note, `%${listState.checkins.q}%`)
          : undefined,
        listState.checkins.kind
          ? eq(formResponseCheckins.kind, listState.checkins.kind)
          : undefined,
      )

      const [
        caTotalRows,
        caFilteredRows,
        caRows,
        incidentTotalRows,
        incidentFilteredRows,
        incidentRows,
        checkinTotalRows,
        checkinFilteredRows,
        checkinRows,
      ] = await Promise.all([
        tx.select({ count: count() }).from(correctiveActions).where(caBaseWhere),
        tx.select({ count: count() }).from(correctiveActions).where(caWhere),
        tx
          .select({
            id: correctiveActions.id,
            reference: correctiveActions.reference,
            title: correctiveActions.title,
            status: correctiveActions.status,
          })
          .from(correctiveActions)
          .where(caWhere)
          .orderBy(
            listState.correctiveActions.sort === 'oldest'
              ? asc(correctiveActions.createdAt)
              : desc(correctiveActions.createdAt),
            listState.correctiveActions.sort === 'oldest'
              ? asc(correctiveActions.id)
              : desc(correctiveActions.id),
          )
          .limit(listState.correctiveActions.perPage)
          .offset((listState.correctiveActions.page - 1) * listState.correctiveActions.perPage),
        tx.select({ count: count() }).from(incidents).where(incidentBaseWhere),
        tx.select({ count: count() }).from(incidents).where(incidentWhere),
        tx
          .select({
            id: incidents.id,
            reference: incidents.reference,
            title: incidents.title,
            status: incidents.status,
          })
          .from(incidents)
          .where(incidentWhere)
          .orderBy(
            listState.incidents.sort === 'oldest'
              ? asc(incidents.reportedAt)
              : desc(incidents.reportedAt),
            listState.incidents.sort === 'oldest' ? asc(incidents.id) : desc(incidents.id),
          )
          .limit(listState.incidents.perPage)
          .offset((listState.incidents.page - 1) * listState.incidents.perPage),
        tx.select({ count: count() }).from(formResponseCheckins).where(checkinBaseWhere),
        tx.select({ count: count() }).from(formResponseCheckins).where(checkinWhere),
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
          .where(checkinWhere)
          .orderBy(
            listState.checkins.sort === 'oldest'
              ? asc(formResponseCheckins.recordedAt)
              : desc(formResponseCheckins.recordedAt),
            listState.checkins.sort === 'oldest'
              ? asc(formResponseCheckins.id)
              : desc(formResponseCheckins.id),
          )
          .limit(listState.checkins.perPage)
          .offset((listState.checkins.page - 1) * listState.checkins.perPage),
      ])
      return {
        correctiveActions: {
          rows: caRows,
          total: Number(caTotalRows[0]?.count ?? 0),
          filteredTotal: Number(caFilteredRows[0]?.count ?? 0),
        },
        incidents: {
          rows: incidentRows,
          total: Number(incidentTotalRows[0]?.count ?? 0),
          filteredTotal: Number(incidentFilteredRows[0]?.count ?? 0),
        },
        checkins: {
          rows: checkinRows,
          total: Number(checkinTotalRows[0]?.count ?? 0),
          filteredTotal: Number(checkinFilteredRows[0]?.count ?? 0),
        },
      }
    })()

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
          and(
            eq(formAutomations.templateId, baseData.template.id),
            eq(formAutomations.enabled, true),
          ),
        ),
    ])
    return {
      steps,
      comments: {
        ...comments,
        total: Number(commentTotalRows[0]?.count ?? 0),
      },
      scoreRows,
      spawned,
      sites,
      allPeople,
      currentPerson: currentPersonRows[0] ?? null,
      manualFlows,
    }
  })

  const data = { ...baseData, ...detailData }
  const {
    response,
    template,
    version,
    steps,
    comments,
    scoreRows,
    spawned,
    sites,
    allPeople,
    currentPerson,
    manualFlows,
  } = data
  const {
    correctiveActions: spawnedCorrectiveActions,
    incidents: spawnedIncidents,
    checkins,
  } = spawned

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
  const userRoleKeys = effectiveRoleKeys
  const canOperateApp = canAccessTemplate(ctx, template, userRoleKeys, 'operate')
  const recordValues = responsePayload(
    response.data ?? {},
    response.status === 'draft' || response.status === 'in_progress'
      ? (response.draftData as FormResponseDraftData | null)
      : null,
  )
  // Resolve picker-bound entity attributes so `entity_attr` formula fields
  // in the response editor show the same live values the filler did.
  // RLS-scoped via the request context.
  const entitiesByField =
    active === 'response' ? await loadEntitiesForPickers(ctx, version.schema, recordValues) : {}
  const callerMembershipId = ctx.membership?.id ?? null
  const isOwner = response.submittedBy !== null && response.submittedBy === callerMembershipId
  const canEditRecord = canOperateApp && canEditResponsePayload(ctx, response)
  const canCreateCorrectiveAction = canOperateApp && can(ctx, 'ca.create')
  const canCreateIncident = canOperateApp && can(ctx, 'incidents.create')
  const canManageRecord =
    canOperateApp &&
    (ctx.isSuperAdmin || ctx.permissions.has('*') || can(ctx, 'forms.response.read.all') || isOwner)
  const lockRoles = recordConfig?.locking?.lockRoles
  const unlockRoles = recordConfig?.locking?.unlockRoles
  const canLockRecord =
    canOperateApp &&
    (lockRoles && lockRoles.length > 0
      ? ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(userRoleKeys, lockRoles)
      : canManageRecord)
  const canUnlockRecord =
    canOperateApp &&
    (unlockRoles && unlockRoles.length > 0
      ? ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(userRoleKeys, unlockRoles)
      : canManageRecord)

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
  if (canOperateApp) {
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
    locale: ctx.locale,
    defaultLocale: ctx.defaultLocale,
  })

  // Set by finalizeResponse when required-field validation blocks the finalize.
  const finalizeErrorCount = Number(pickString(sp.finalizeError) ?? '0')

  const drawerParam = pickString(sp.drawer)
  const openDrawer: SpawnDrawerKind =
    drawerParam === 'spawn-ca' && canCreateCorrectiveAction
      ? 'spawn-ca'
      : drawerParam === 'spawn-incident' && canCreateIncident
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
      title: localizeText(wf.title, ctx.locale, wf.key, ctx.defaultLocale),
      signatureRequired: !!wf.signatureRequired,
      assigneeKind: wf.assignee.type,
      assigneeLabel,
      status: (row?.status ?? 'pending') as WorkflowStepProp['status'],
      signedAt: row?.signedAt ? row.signedAt.toISOString() : null,
      signedBy: signedByName,
      signatureUrl: row?.signatureAttachmentId ? attachmentUrl(row.signatureAttachmentId) : null,
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

  const pendingFlowGates =
    active === 'response'
      ? await getPendingFlowGatesForSubject(
          ctx,
          'form_template',
          id,
          canManageSubjectGates(ctx, 'form_template', null),
        )
      : []
  const activityData =
    active === 'audit' && auditEnabled
      ? await activityPageForEntity(ctx, 'form_response', id, {
          q: listState.activity.q,
          action: listState.activity.action,
          page: listState.activity.page,
          perPage: listState.activity.perPage,
          dir: listState.activity.sort === 'oldest' ? 'asc' : 'desc',
        })
      : { rows: [], total: 0, filteredTotal: 0, actions: [] }

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
          title={tGeneratedValue(template.name)}
          subtitle={tGenerated('m_14c3dfbc8a08e9', {
            value0: id.slice(0, 8),
            value1: version.version,
          })}
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
                <GeneratedValue value={response.status.replace('_', ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  reviewEnabled ? (
                    <ComplianceBadge status={complianceStatus} score={complianceScore} />
                  ) : null
                }
              />
            </div>
          }
          actions={
            <>
              <GeneratedValue
                value={
                  canCreateCorrectiveAction ? (
                    <Link
                      href={`${basePath}?drawer=spawn-ca${active === 'response' ? '' : `&tab=${active}`}`}
                    >
                      <Button
                        variant={complianceStatus === 'non_compliant' ? 'default' : 'outline'}
                      >
                        <Plus size={14} /> <GeneratedText id="m_07b71156553d0b" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  canCreateIncident ? (
                    <Link
                      href={`${basePath}?drawer=spawn-incident${active === 'response' ? '' : `&tab=${active}`}`}
                    >
                      <Button variant="outline">
                        <ShieldAlert size={14} /> <GeneratedText id="m_0b7f374a64e552" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <RecordActionBar responseId={id} buttons={manualButtons} />
              <GeneratedValue
                value={
                  !locked ? (
                    <>
                      <GeneratedValue
                        value={
                          canEditRecord &&
                          (response.status === 'draft' || response.status === 'in_progress') ? (
                            <form action={finalizeResponse} className="inline">
                              <input type="hidden" name="responseId" value={id} />
                              <Button type="submit" variant="default">
                                <CheckCircle2 size={14} /> <GeneratedText id="m_0263993096fef0" />
                              </Button>
                            </form>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          canLockRecord ? (
                            <form action={lockResponse} className="inline">
                              <input type="hidden" name="responseId" value={id} />
                              <Button type="submit" variant="outline">
                                <Lock size={14} /> <GeneratedText id="m_19f2c846c5777a" />
                              </Button>
                            </form>
                          ) : null
                        }
                      />
                    </>
                  ) : canUnlockRecord ? (
                    <form action={unlockResponse} className="inline">
                      <input type="hidden" name="responseId" value={id} />
                      <Button type="submit" variant="outline">
                        <LockOpen size={14} /> <GeneratedText id="m_0ca830c9381fd6" />
                      </Button>
                    </form>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  supportsReopen && canUnlockRecord ? (
                    <form action={reopenResponse} className="inline">
                      <input type="hidden" name="responseId" value={id} />
                      <Button type="submit" variant="outline">
                        <Undo2 size={14} /> <GeneratedText id="m_0341d048ec832d" />
                      </Button>
                    </form>
                  ) : null
                }
              />
              <Link href={`/apps/responses/${id}/pdf`}>
                <Button variant="outline">
                  <FileText size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
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
            <GeneratedValue
              value={
                finalizeErrorCount > 0 ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      <GeneratedText id="m_1877a2cd4c7963" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedValue value={finalizeErrorCount} />{' '}
                      <GeneratedText id="m_1d6aa8702d3fac" />
                      <GeneratedValue
                        value={
                          finalizeErrorCount === 1 ? (
                            <GeneratedText id="m_12f668c7352caf" />
                          ) : (
                            <GeneratedText id="m_156505465b1f33" />
                          )
                        }
                      />{' '}
                      <GeneratedText id="m_1f960ee1f594ac" />
                    </AlertDescription>
                  </Alert>
                ) : null
              }
            />
            <GeneratedValue
              value={
                reviewEnabled && complianceStatus === 'non_compliant' ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      <GeneratedText id="m_0d41602b36f385" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_1469688270fa41" />{' '}
                      <GeneratedValue value={complianceScore.toFixed(1)} /> ·{' '}
                      <GeneratedValue value={failedFieldKeys.length} />{' '}
                      <GeneratedText id="m_1d8bc417edc4a2" />
                      <GeneratedValue
                        value={
                          failedFieldKeys.length === 1 ? (
                            ''
                          ) : (
                            <GeneratedText id="m_00ded356f0f424" />
                          )
                        }
                      />
                      <GeneratedText id="m_0ed7a8c1dd855d" />
                    </AlertDescription>
                  </Alert>
                ) : reviewEnabled && flagsFollowup ? (
                  <Alert variant="warning">
                    <AlertTitle>
                      <GeneratedText id="m_12caee20e6a339" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_10df82d7ff45d3" /> <GeneratedValue value={failCount} />{' '}
                      <GeneratedText id="m_197c5828079212" />
                      <GeneratedValue
                        value={failCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                      />{' '}
                      <GeneratedText id="m_14b08ce3cf96d3" />
                    </AlertDescription>
                  </Alert>
                ) : null
              }
            />
            <GeneratedValue
              value={
                locked ? (
                  <Alert variant="warning">
                    <AlertTitle>
                      <GeneratedText id="m_11f71ec9a1cf5b" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_0803a334cce8bf" />
                    </AlertDescription>
                  </Alert>
                ) : !canEditRecord ? (
                  <Alert variant="warning">
                    <AlertTitle>
                      <GeneratedText id="m_0cd6abb2df6fc8" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_1f28e5133b4b0e" />
                    </AlertDescription>
                  </Alert>
                ) : null
              }
            />
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
              ? [{ key: 'comments', label: 'Comments', count: comments.total }]
              : []),
            ...(auditEnabled ? [{ key: 'audit', label: 'Audit trail' }] : []),
          ]}
        />
      }
    >
      <div className="space-y-5">
        <GeneratedValue
          value={
            active === 'response' ? (
              <>
                <GeneratedValue
                  value={
                    response.monitorStatus ? (
                      <MonitorPanel
                        responseId={response.id}
                        monitorStatus={response.monitorStatus as MonitorStatus}
                        nextCheckinDueAt={
                          response.nextCheckinDueAt ? response.nextCheckinDueAt.toISOString() : null
                        }
                        intervalMinutes={response.checkinIntervalMinutes}
                        requireGeo={response.monitorRequireGeo ?? false}
                        readOnly={!canOperateApp}
                        history={
                          <CheckinHistory
                            basePath={basePath}
                            currentParams={sp}
                            params={listState.checkins}
                            data={checkins}
                            timeZone={ctx.timezone}
                            locale={ctx.locale}
                          />
                        }
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    reviewEnabled && failedFieldKeys.length > 0 ? (
                      <Section
                        title={tGenerated('m_04bf39d2ddc5a9', { value0: failedFieldKeys.length })}
                        subtitle={tGenerated('m_07bbef94ea1b18')}
                      >
                        <ul className="space-y-2 text-sm">
                          <GeneratedValue
                            value={failedFieldKeys.map((key) => {
                              const label = labelForField(
                                version.schema,
                                key,
                                ctx.locale,
                                ctx.defaultLocale,
                              )
                              const displayValue = displayValueForField(
                                version.schema,
                                recordValues,
                                key,
                                ctx.locale,
                                ctx.defaultLocale,
                              )
                              return (
                                <li
                                  key={key}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40"
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium text-rose-900 dark:text-rose-200">
                                      <GeneratedValue value={label} />
                                    </div>
                                    <div className="text-xs text-rose-700 dark:text-rose-300">
                                      <GeneratedText id="m_0d06009e41469d" />{' '}
                                      <strong>
                                        <GeneratedValue value={displayValue} />
                                      </strong>
                                    </div>
                                  </div>
                                  <GeneratedValue
                                    value={
                                      canCreateCorrectiveAction ? (
                                        <Link
                                          href={`${basePath}?drawer=spawn-ca&failedField=${encodeURIComponent(key)}${active === 'response' ? '' : `&tab=${active}`}`}
                                        >
                                          <Button size="sm" variant="outline">
                                            <Plus size={12} />{' '}
                                            <GeneratedText id="m_07b71156553d0b" />
                                          </Button>
                                        </Link>
                                      ) : null
                                    }
                                  />
                                </li>
                              )
                            })}
                          />
                        </ul>
                      </Section>
                    ) : null
                  }
                />

                <SpawnedRecordsSection
                  basePath={basePath}
                  currentParams={sp}
                  correctiveActionParams={listState.correctiveActions}
                  correctiveActionData={spawnedCorrectiveActions}
                  incidentParams={listState.incidents}
                  incidentData={spawnedIncidents}
                />

                <GeneratedValue
                  value={
                    reviewEnabled && scoreRows.length > 0 ? (
                      <Section title={tGenerated('m_061d0ca018c188')}>
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <Badge variant="success">
                            <GeneratedValue value={passCount} />{' '}
                            <GeneratedText id="m_11c8b183d5b8e9" />
                          </Badge>
                          <Badge variant="destructive">
                            <GeneratedValue value={failCount} />{' '}
                            <GeneratedText id="m_14803909da5dbb" />
                          </Badge>
                          <Badge variant="secondary">
                            <GeneratedValue value={scoreRows.length - passCount - failCount} />{' '}
                            <GeneratedText id="m_0be3e9c2265465" />
                          </Badge>
                          <span className="text-slate-500">
                            <GeneratedValue value={scoreRows.length} />{' '}
                            <GeneratedText id="m_0e2f8b178f556a" />
                          </span>
                        </div>
                      </Section>
                    ) : null
                  }
                />

                <GeneratedValue
                  value={(() => {
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
                />

                <GeneratedValue
                  value={
                    canOperateApp && pendingFlowGates.length > 0 ? (
                      <FlowApprovals gates={pendingFlowGates} />
                    ) : null
                  }
                />

                <GeneratedValue
                  value={
                    reviewEnabled ? (
                      <Section
                        title={tGenerated('m_0297c8dcc879bc', { value0: workflowStepProps.length })}
                        defaultOpen={workflowStepProps.length > 0}
                      >
                        <GeneratedValue
                          value={
                            workflowStepProps.length === 0 ? (
                              <p className="text-sm text-slate-500">
                                <GeneratedText id="m_09ac0f9976f5a5" />
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
                                canAct={canOperateApp}
                              />
                            )
                          }
                        />
                      </Section>
                    ) : null
                  }
                />
              </>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'comments' && commentsEnabled ? (
              <div className="space-y-4">
                <CommentsPanel
                  basePath={basePath}
                  currentParams={sp}
                  params={listState.comments}
                  data={comments}
                  timeZone={ctx.timezone}
                  locale={ctx.locale}
                />
                <GeneratedValue
                  value={
                    canOperateApp ? (
                      <Section title={tGenerated('m_0ad531739f9284')}>
                        <form action={addComment} className="space-y-3">
                          <input type="hidden" name="responseId" value={id} />
                          <Textarea
                            name="body"
                            rows={3}
                            required
                            maxLength={10_000}
                            placeholder={tGenerated('m_0e027bf8f97672')}
                          />
                          <div className="flex justify-end">
                            <Button type="submit">
                              <Send size={14} /> <GeneratedText id="m_1491b04b6d4240" />
                            </Button>
                          </div>
                        </form>
                      </Section>
                    ) : null
                  }
                />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'audit' && auditEnabled ? (
              <AuditTrailPanel
                basePath={basePath}
                currentParams={sp}
                params={listState.activity}
                data={activityData}
                timeZone={ctx.timezone}
                locale={ctx.locale}
              />
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          canCreateCorrectiveAction || canCreateIncident ? (
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
                    locale: ctx.locale,
                    defaultLocale: ctx.defaultLocale,
                  })
                })()
              }
              spawnCa={createCorrectiveActionFromResponse}
              spawnIncident={createIncidentFromResponse}
            />
          ) : null
        }
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
        <CheckCircle2 size={12} /> <GeneratedText id="m_1ec447c1ea1bd2" />{' '}
        <GeneratedValue value={score.toFixed(0)} />%
      </span>
    )
  }
  if (status === 'non_compliant') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900">
        <AlertTriangle size={12} /> <GeneratedText id="m_0e1fbb8b9fe5df" />{' '}
        <GeneratedValue value={score.toFixed(0)} />%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
      <Clock size={12} /> <GeneratedText id="m_08b7d8b7086dea" />
    </span>
  )
}
