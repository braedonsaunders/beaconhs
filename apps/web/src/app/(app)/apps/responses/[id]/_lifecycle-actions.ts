'use server'

// Record lifecycle actions for the unified Builder-app record page — the
// native-module-parity counterparts of incidents' lock/unlock + CA's
// close/reopen. Driven by plain `<form action={…}>` header buttons so they work
// without client JS. Lock/unlock honour the app's configured lockRoles /
// unlockRoles (designer Record tab) when set; otherwise they fall back to a
// coarse manage check (super-admin, the forms.response.read.all "reviewer"
// tier, or the record owner). Super-admins always pass.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { lockFormResponseForMutation } from '@beaconhs/db'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  people,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { normalizeFormResponseData, validateResponse } from '@beaconhs/forms-core'
import { can } from '@beaconhs/tenant'
import { domainEventActor, recordDomainEvent } from '@beaconhs/events'
import { formSubmittedEvent } from '@beaconhs/integrations'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { canAccessTemplate } from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'
import { materializeFormResponseEvidenceChange } from '@/lib/forms/form-response-evidence'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

// App-level record behaviour config (form_templates.record_config). Mirrors the
// shape authored in the designer's Record tab.
type RecordConfig = {
  editingMode?: 'guided_fill' | 'inline_record' | 'both'
  locking?: {
    enabled?: boolean
    trigger?: 'manual' | 'on_finalize' | 'on_signoff'
    lockRoles?: string[]
    unlockRoles?: string[]
    autoLockOnFinalize?: boolean
  }
}

function canManageRecord(ctx: Ctx, ownerId: string | null): boolean {
  return (
    ctx.isSuperAdmin ||
    ctx.permissions.has('*') ||
    can(ctx, 'forms.response.read.all') ||
    (ownerId != null && ownerId === (ctx.membership?.id ?? null))
  )
}

function hasAnyRole(roleKeys: ReadonlySet<string>, allowed: string[] | null | undefined): boolean {
  return !!allowed && allowed.length > 0 && allowed.some((r) => roleKeys.has(r))
}

type LockGateRec = { submittedBy: string | null; recordConfig: unknown }

// Lock is restricted to the app's configured `lockRoles` when any are set
// (super-admins always pass); otherwise it falls back to the coarse manage tier.
function canLockRecord(ctx: Ctx, rec: LockGateRec, roleKeys: ReadonlySet<string>): boolean {
  const roles = (rec.recordConfig as RecordConfig | null)?.locking?.lockRoles
  if (roles && roles.length > 0) {
    return ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(roleKeys, roles)
  }
  return canManageRecord(ctx, rec.submittedBy)
}

// Unlock (and reopen, which clears the lock) is restricted to `unlockRoles` when set.
function canUnlockRecord(ctx: Ctx, rec: LockGateRec, roleKeys: ReadonlySet<string>): boolean {
  const roles = (rec.recordConfig as RecordConfig | null)?.locking?.unlockRoles
  if (roles && roles.length > 0) {
    return ctx.isSuperAdmin || ctx.permissions.has('*') || hasAnyRole(roleKeys, roles)
  }
  return canManageRecord(ctx, rec.submittedBy)
}

async function loadRecord(ctx: Ctx, responseId: string) {
  if (!isUuid(responseId)) return null
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        id: formResponses.id,
        status: formResponses.status,
        locked: formResponses.locked,
        submittedBy: formResponses.submittedBy,
        submittedAt: formResponses.submittedAt,
        data: formResponses.data,
        draftData: formResponses.draftData,
        templateId: formResponses.templateId,
        category: formTemplates.category,
        recordConfig: formTemplates.recordConfig,
        templateStatus: formTemplates.status,
        templateAllowedRoles: formTemplates.allowedRoles,
        templateDeletedAt: formTemplates.deletedAt,
        schema: formTemplateVersions.schema,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(
        and(
          eq(formResponses.id, responseId),
          eq(formResponses.tenantId, ctx.tenantId),
          isNull(formResponses.deletedAt),
        ),
      )
      .limit(1)
    if (!row) return null
    const roleKeys = await getEffectiveRoleKeys(ctx, tx)
    return canAccessTemplate(
      ctx,
      {
        status: row.templateStatus,
        allowedRoles: row.templateAllowedRoles,
        deletedAt: row.templateDeletedAt,
      },
      roleKeys,
      'operate',
    )
      ? row
      : null
  })
}

export async function lockResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec) return
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canLockRecord(ctx, rec, roleKeys)) return
  const locked = await ctx.db(async (tx) => {
    const before = await lockFormResponseForMutation(tx, ctx.tenantId, responseId)
    if (!before) return null
    const [updated] = await tx
      .update(formResponses)
      .set({ locked: true, lockedAt: new Date(), lockedByTenantUserId: ctx.membership?.id ?? null })
      .where(and(eq(formResponses.id, responseId), eq(formResponses.locked, false)))
      .returning({ id: formResponses.id })
    return updated ?? null
  })
  if (!locked) return
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Record locked',
  })
  revalidatePath(`/apps/responses/${responseId}`)
}

export async function unlockResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec) return
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canUnlockRecord(ctx, rec, roleKeys)) return
  const unlocked = await ctx.db(async (tx) => {
    const before = await lockFormResponseForMutation(tx, ctx.tenantId, responseId)
    if (!before) return null
    const [updated] = await tx
      .update(formResponses)
      .set({ locked: false, lockedAt: null, lockedByTenantUserId: null })
      .where(and(eq(formResponses.id, responseId), eq(formResponses.locked, true)))
      .returning({ id: formResponses.id })
    return updated ?? null
  })
  if (!unlocked) return
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Record unlocked',
  })
  revalidatePath(`/apps/responses/${responseId}`)
}

// Finalize a live record: recompute compliance, mark it submitted (or
// non-compliant), rebuild the participant index, optionally auto-lock, and fire
// the template's on-submit Flows. The inline-edit counterpart of the wizard's
// Submit — preserves all the on-submit side effects.
export async function finalizeResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec || rec.locked || !canManageRecord(ctx, rec.submittedBy)) return
  // Only live records can be finalized — invoking this action against a
  // submitted / in_review / closed response would silently rewrite its status
  // and re-fire the on-submit flows (duplicate CAPAs / emails).
  if (rec.status !== 'draft' && rec.status !== 'in_progress') return

  const rawData = responsePayload(rec.data ?? {}, rec.draftData as FormResponseDraftData | null)

  // Enforce required fields exactly like the guided wizard's submit path —
  // Finalize must never commit a record whose status says "submitted" while
  // required signatures/fields are empty. Errors bounce back to the record
  // page as a banner.
  const rawValidationErrors = validateResponse(rec.schema, rawData, 'submit')
  if (rawValidationErrors.length > 0) {
    redirect(`/apps/responses/${responseId}?finalizeError=${rawValidationErrors.length}`)
  }

  const data = normalizeFormResponseData(rec.schema, rawData)
  const validationErrors = validateResponse(rec.schema, data, 'submit')
  if (validationErrors.length > 0) {
    redirect(`/apps/responses/${responseId}?finalizeError=${validationErrors.length}`)
  }

  const rows: Record<string, Array<Record<string, unknown>>> = {}
  for (const sec of rec.schema.sections) {
    if (!sec.repeating) continue
    const v = data[sec.id]
    rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }
  const verdict = computeFormScore(rec.schema, data, rows)
  const finalStatus =
    verdict.status === 'non_compliant' ? ('non_compliant' as const) : ('submitted' as const)

  const cfg = (rec.recordConfig as RecordConfig | null) ?? null
  const autoLock = !!cfg?.locking?.enabled && !!cfg.locking.autoLockOnFinalize

  const [submitterPerson] = await ctx.db((tx) =>
    tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.userId, ctx.userId)))
      .limit(1),
  )

  const submittedAt = rec.submittedAt ?? new Date()
  const finalized = await ctx.db(async (tx) => {
    const before = await lockFormResponseForMutation(tx, ctx.tenantId, responseId)
    if (!before) return false
    const [claimed] = await tx
      .update(formResponses)
      .set({
        status: finalStatus,
        submittedBy: rec.submittedBy ?? ctx.membership?.id ?? null,
        submittedAt,
        data,
        draftData: null,
        draftUpdatedAt: null,
        complianceScore: String(verdict.score),
        complianceStatus: verdict.status,
        ...(autoLock
          ? { locked: true, lockedAt: new Date(), lockedByTenantUserId: ctx.membership?.id ?? null }
          : {}),
      })
      .where(
        and(
          eq(formResponses.id, responseId),
          eq(formResponses.locked, false),
          inArray(formResponses.status, ['draft', 'in_progress']),
        ),
      )
      .returning()
    if (!claimed) return false
    await repopulateParticipants(tx, {
      tenantId: ctx.tenantId,
      responseId,
      templateId: rec.templateId,
      category: rec.category ?? null,
      schema: rec.schema,
      data,
      submittedAt,
      submitterPersonId: submitterPerson?.id ?? null,
    })
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'form.submitted',
      subjectId: responseId,
      dedupKey: `form.submitted:${responseId}:${submittedAt.toISOString()}`,
      payload: {
        integration: formSubmittedEvent(ctx.tenantId, {
          id: responseId,
          templateId: rec.templateId,
          status: verdict.status,
          submittedAt,
          complianceScore: verdict.score,
          complianceStatus: verdict.status,
          data,
        }),
        web: {
          kind: 'form_submitted',
          subjectId: responseId,
          templateId: rec.templateId,
          data,
          score: verdict.score,
          status: verdict.status,
          recap: false,
          actor: domainEventActor(ctx),
        },
      },
    })
    await materializeFormResponseEvidenceChange(tx, ctx.tenantId, before, claimed)
    return true
  })
  if (!finalized) return

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: `Record finalized (${finalStatus})`,
  })
  revalidatePath(`/apps/responses/${responseId}`)
}

export async function reopenResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec) return
  const roleKeys = await getEffectiveRoleKeys(ctx)
  if (!canUnlockRecord(ctx, rec, roleKeys)) return
  const reopened = await ctx.db(async (tx) => {
    const before = await lockFormResponseForMutation(tx, ctx.tenantId, responseId)
    if (!before) return null
    const [updated] = await tx
      .update(formResponses)
      .set({
        status: 'in_progress',
        closedAt: null,
        locked: false,
        lockedAt: null,
        lockedByTenantUserId: null,
      })
      .where(
        and(
          eq(formResponses.id, responseId),
          inArray(formResponses.status, ['closed', 'rejected']),
        ),
      )
      .returning()
    if (!updated) return null
    await materializeFormResponseEvidenceChange(tx, ctx.tenantId, before, updated)
    return updated
  })
  if (!reopened) return
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Record reopened',
  })
  revalidatePath(`/apps/responses/${responseId}`)
}
