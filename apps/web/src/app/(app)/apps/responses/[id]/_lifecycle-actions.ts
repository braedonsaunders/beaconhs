'use server'

// Record lifecycle actions for the unified Builder-app record page — the
// native-module-parity counterparts of incidents' lock/unlock + CA's
// close/reopen. Driven by plain `<form action={…}>` header buttons so they work
// without client JS. Lock/unlock honour the app's configured lockRoles /
// unlockRoles (designer Record tab) when set; otherwise they fall back to a
// coarse manage check (super-admin, the forms.response.read.all "reviewer"
// tier, or the record owner). Super-admins always pass.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  people,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { getUserRoleKeys } from '@/app/(app)/apps/_lib/access'
import { repopulateParticipants } from '@/app/(app)/apps/_lib/participants'
import { runOnSubmitAutomations } from '@/app/(app)/apps/_lib/run-automations'

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

function responsePayload(
  data: Record<string, unknown> | null,
  draftData: FormResponseDraftData | null,
): Record<string, unknown> {
  if (!draftData) return data ?? {}
  return {
    ...(draftData.values ?? {}),
    ...(draftData.rows ?? {}),
    ...(data ?? {}),
  }
}

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
        schema: formTemplateVersions.schema,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .where(and(eq(formResponses.id, responseId), eq(formResponses.tenantId, ctx.tenantId)))
      .limit(1)
    return row ?? null
  })
}

export async function lockResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec) return
  const roleKeys = await getUserRoleKeys(ctx)
  if (!canLockRecord(ctx, rec, roleKeys)) return
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ locked: true, lockedAt: new Date(), lockedByTenantUserId: ctx.membership?.id ?? null })
      .where(eq(formResponses.id, responseId)),
  )
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
  const roleKeys = await getUserRoleKeys(ctx)
  if (!canUnlockRecord(ctx, rec, roleKeys)) return
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ locked: false, lockedAt: null, lockedByTenantUserId: null })
      .where(eq(formResponses.id, responseId)),
  )
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

  const data = responsePayload(rec.data ?? {}, rec.draftData as FormResponseDraftData | null)
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

  await ctx.db(async (tx) => {
    await tx
      .update(formResponses)
      .set({
        status: finalStatus,
        submittedBy: rec.submittedBy ?? ctx.membership?.id ?? null,
        submittedAt: rec.submittedAt ?? new Date(),
        data,
        draftData: null,
        draftUpdatedAt: null,
        complianceScore: String(verdict.score),
        complianceStatus: verdict.status,
        ...(autoLock
          ? { locked: true, lockedAt: new Date(), lockedByTenantUserId: ctx.membership?.id ?? null }
          : {}),
      })
      .where(eq(formResponses.id, responseId))
    await repopulateParticipants(tx, {
      tenantId: ctx.tenantId,
      responseId,
      templateId: rec.templateId,
      category: rec.category ?? null,
      schema: rec.schema,
      data,
      submittedAt: new Date(),
      submitterPersonId: submitterPerson?.id ?? null,
    })
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: `Record finalized (${finalStatus})`,
  })
  try {
    await runOnSubmitAutomations(ctx, {
      templateId: rec.templateId,
      responseId,
      data,
      score: verdict.score,
      status: verdict.status,
    })
  } catch {
    // automations are non-critical to finalize
  }
  revalidatePath(`/apps/responses/${responseId}`)
}

export async function reopenResponse(formData: FormData) {
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  const rec = await loadRecord(ctx, responseId)
  if (!rec) return
  const roleKeys = await getUserRoleKeys(ctx)
  if (!canUnlockRecord(ctx, rec, roleKeys)) return
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({
        status: 'in_progress',
        closedAt: null,
        locked: false,
        lockedAt: null,
        lockedByTenantUserId: null,
      })
      .where(eq(formResponses.id, responseId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Record reopened',
  })
  revalidatePath(`/apps/responses/${responseId}`)
}
