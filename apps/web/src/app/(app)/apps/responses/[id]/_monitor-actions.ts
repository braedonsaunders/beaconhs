'use server'

// Server actions for the live monitored-session panel on a form response: the
// worker's one-tap "I'm OK" check-in (resets the timer + re-activates an
// escalated session) and end / cancel. The overdue escalation itself is fired
// server-side by the worker scan (form_session_overdue_scan).
// See docs/monitored-sessions-design.md.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { formResponseCheckins, formResponses } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'

export type ActionResult = { ok: true } | { ok: false; error: string }

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>
type LoadedSession = NonNullable<Awaited<ReturnType<typeof loadSession>>>

function safeTenantUserId(ctx: Ctx): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}

function ownsSession(ctx: Ctx, session: LoadedSession): boolean {
  return session.submittedBy === (ctx.membership?.id ?? null)
}

function canManageSession(ctx: Ctx, session: LoadedSession): boolean {
  return (
    ctx.isSuperAdmin ||
    ctx.permissions.has('*') ||
    can(ctx, 'forms.response.read.all') ||
    ownsSession(ctx, session)
  )
}

// Load the monitored session AND enforce per-user record visibility, so a user
// can't drive (check in / end / cancel) another user's session by guessing its
// id. Returns null when the response is missing OR not visible to the caller.
async function loadSession(ctx: Ctx, id: string) {
  return ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        id: formResponses.id,
        monitorStatus: formResponses.monitorStatus,
        checkinIntervalMinutes: formResponses.checkinIntervalMinutes,
        submittedBy: formResponses.submittedBy,
        subjectPersonId: formResponses.subjectPersonId,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(and(eq(formResponses.id, id), isNull(formResponses.deletedAt)))
      .limit(1)
    if (!r) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'forms.response',
      ownerIds: [r.submittedBy],
      personId: r.subjectPersonId,
      siteId: r.siteOrgUnitId,
    })
    return visible ? r : null
  })
}

/**
 * Record a check-in for a monitored session. Always re-activates the session
 * (clearing a missed/escalated state) and resets the next-due timer.
 */
export async function recordSessionCheckin(args: {
  responseId: string
  geoLat?: number | null
  geoLng?: number | null
  note?: string | null
}): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const s = await loadSession(ctx, args.responseId)
  if (!s) return { ok: false, error: 'Session not found.' }
  if (!ownsSession(ctx, s) && !ctx.isSuperAdmin && !ctx.permissions.has('*')) {
    return { ok: false, error: 'Only the session owner can check in.' }
  }
  if (!s.monitorStatus) return { ok: false, error: 'This response is not a monitored session.' }
  if (s.monitorStatus === 'completed' || s.monitorStatus === 'cancelled') {
    return { ok: false, error: 'This session has already ended.' }
  }
  const interval = s.checkinIntervalMinutes ?? 30
  const now = new Date()
  await ctx.db(async (tx) => {
    await tx.insert(formResponseCheckins).values({
      tenantId: ctx.tenantId,
      responseId: args.responseId,
      kind: 'manual',
      geoLat: typeof args.geoLat === 'number' ? args.geoLat : null,
      geoLng: typeof args.geoLng === 'number' ? args.geoLng : null,
      note: args.note?.trim() || null,
      byTenantUserId: safeTenantUserId(ctx),
    })
    await tx
      .update(formResponses)
      .set({
        monitorStatus: 'active',
        lastCheckinAt: now,
        nextCheckinDueAt: new Date(now.getTime() + interval * 60_000),
        escalatedAt: null,
      })
      .where(eq(formResponses.id, args.responseId))
  })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: args.responseId,
    action: 'update',
    summary: 'Session check-in',
    metadata: { geo: args.geoLat != null && args.geoLng != null },
  })
  revalidatePath(`/apps/responses/${args.responseId}`)
  return { ok: true }
}

async function closeSession(
  responseId: string,
  status: 'completed' | 'cancelled',
  summary: string,
): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const s = await loadSession(ctx, responseId)
  if (!s) return { ok: false, error: 'Session not found.' }
  if (!canManageSession(ctx, s)) return { ok: false, error: 'You cannot close this session.' }
  if (!s.monitorStatus) return { ok: false, error: 'This response is not a monitored session.' }
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ monitorStatus: status, closedAt: new Date() })
      .where(eq(formResponses.id, responseId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary,
  })
  revalidatePath(`/apps/responses/${responseId}`)
  revalidatePath('/apps/responses')
  return { ok: true }
}

export async function endSession(responseId: string): Promise<ActionResult> {
  return closeSession(responseId, 'completed', 'Session completed')
}

export async function cancelSession(responseId: string): Promise<ActionResult> {
  return closeSession(responseId, 'cancelled', 'Session cancelled')
}
