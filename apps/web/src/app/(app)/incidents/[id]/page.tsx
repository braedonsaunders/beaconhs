import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  Activity,
  AlertTriangle,
  Building2,
  Camera,
  Clock,
  Copy,
  FileText,
  Gauge,
  HeartPulse,
  HelpCircle,
  History,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import type { AppLocale } from '@beaconhs/i18n'
import {
  attachments,
  correctiveActions,
  departments,
  incidentAttachments,
  incidentClassifications,
  incidentContributingFactors,
  incidentEvents,
  incidentInjuries,
  incidentInjuryTypeAssignments,
  incidentInjuryTypes,
  incidentLostTimeEvents,
  incidentPeople,
  incidentPreventativeSteps,
  incidentRootCauseWhys,
  incidents,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { sendIncidentEmail } from './_send-email'
import { LostTimeAddForm } from './_lost-time-form'
import {
  EventDrawer,
  FactorDrawer,
  PrevStepDrawer,
  WhyDrawer,
  FACTOR_CATEGORIES,
  PREV_STEP_STATUSES,
  type FactorCategory,
  type PrevStepStatus,
} from './_investigation-drawers'
import {
  InjuryDrawer,
  PersonDrawer,
  type InjuryInput,
  type PersonInput,
} from './_people-injury-drawers'
import { IncidentHeaderActions } from './_header-actions'
import { isUuid, pickString } from '@/lib/list-params'
import { attachmentUrl } from '@/lib/attachment-url'
import { parsePhotoEdits } from '@/lib/photo-edits'
import { validateTenantImageAttachmentIdsInTx } from '@/lib/attachment-validation'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { nextReference } from '@/lib/reference'
import { assertCan, can, getRegulatoryTerminology } from '@beaconhs/tenant'
import { canSeeRecord } from '@/lib/visibility'
import { canManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity, recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { parseIncidentInjuryInput } from '@/lib/incident-injury-input'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { ActivityFeed } from '@/components/activity-feed'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { DetailPageLayout } from '@/components/page-layout'
import { PremiumSection as Section } from '@/components/premium-section'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import {
  LiveDateTime,
  LiveField,
  LiveRemoteSelect,
  LiveRichText,
  LiveSelect,
  LiveSeverityRating,
  LiveToggle,
} from '@/components/live-field'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import { incidentStatusChangedEvent } from '@beaconhs/integrations'
import { SeverityBadge, StatusBadge } from '../_badges'

export const dynamic = 'force-dynamic'

const STATUSES = [
  'reported',
  'under_investigation',
  'pending_review',
  'closed',
  'reopened',
] as const

const TYPES = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const

const SEVERITIES = ['first_aid_only', 'medical_aid', 'lost_time', 'fatality', 'no_injury'] as const

// Re-scope guard for the per-incident mutations: the caller already holds the
// relevant write permission, but a self/site-tier user must not be able to
// drive an incident they cannot see by guessing its id. Mirrors the detail
// page's canSeeRecord check (prefix 'incidents', owner = reporter, site).
async function assertCanSeeIncident(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  incidentId: string,
): Promise<void> {
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        reportedByTenantUserId: incidents.reportedByTenantUserId,
        siteOrgUnitId: incidents.siteOrgUnitId,
      })
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'incidents',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
  })
  if (!visible) throw new Error('Incident not found')
}

// ---- Status & lock ---------------------------------------------------------

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return
  const closing = status === 'closed'
  assertCan(ctx, closing ? 'incidents.close' : 'incidents.update')
  await assertCanSeeIncident(ctx, id)
  const eventKey = randomUUID()
  const changed = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        status: incidents.status,
        reference: incidents.reference,
        title: incidents.title,
        type: incidents.type,
        severity: incidents.severity,
      })
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1)
      .for('update')
    if (!row || row.status === status) return null
    await tx
      .update(incidents)
      .set({
        status: status as any,
        closedAt: closing ? new Date() : null,
        inProgress: !closing,
        locked: closing,
      })
      .where(eq(incidents.id, id))
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'incident.status_changed',
      subjectId: id,
      dedupKey: `incident.status_changed:${id}:${eventKey}`,
      payload: {
        notification: {
          kind: 'incident_status_changed',
          incidentId: id,
          fromStatus: row.status,
          toStatus: status,
        },
        integration: incidentStatusChangedEvent(ctx.tenantId, {
          id,
          reference: row.reference,
          title: row.title,
          type: row.type,
          severity: row.severity,
          fromStatus: row.status,
          toStatus: status,
        }),
        web: moduleFlowCommand(ctx, {
          subjectId: id,
          moduleKey: 'incidents',
          event: 'status_change',
          toStatus: status,
        }),
      },
    })
    return true
  })
  if (!changed) return
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: `Status changed to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
  revalidatePath(`/incidents/${id}`)
  revalidatePath('/incidents')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  await assertCanSeeIncident(ctx, id)
  const changed = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({ locked: incidents.locked })
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1)
      .for('update')
    if (!current || current.locked === lock) return false
    await tx.update(incidents).set({ locked: lock }).where(eq(incidents.id, id))
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'incidents',
      event: lock ? 'on_lock' : 'on_unlock',
      occurrenceKey: randomUUID(),
    })
    return true
  })
  if (!changed) return
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: lock ? 'Locked' : 'Unlocked',
    after: { locked: lock },
  })
  revalidatePath(`/incidents/${id}`)
}

// ---- Inline field editor (the single-page form's workhorse) ----------------

async function updateTextField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const ENUMS: Record<string, readonly string[]> = { type: TYPES, severity: SEVERITIES }
  const NULLABLE_IDS = new Set([
    'siteOrgUnitId',
    'departmentId',
    'supervisorPersonId',
    'classificationId',
  ])
  const TS_REQUIRED = new Set(['occurredAt'])
  const TS_NULLABLE = new Set([
    'emsArrivedAt',
    'hospitalArrivedAt',
    'dischargedAt',
    'molNotifiedAt',
  ])
  const DATE_ONLY = new Set([
    'lostTimeFirstDay',
    'lostTimeLastDay',
    'modifiedDutyFirstDay',
    'modifiedDutyLastDay',
  ])
  const INTS = new Set([
    'actualSeverity',
    'potentialSeverity',
    'severityRating',
    'lostTimeDays',
    'modifiedDutyDays',
  ])
  const NUMERICS = new Set(['damageEstimate'])
  const BOOLS = new Set([
    'criticalInjury',
    'ministryOfLabourNotified',
    'emsCalled',
    'firstAidGiven',
    'medicalAttentionReceived',
    'lostTime',
    'modifiedDuty',
    'externallyReportable',
    'policeNotified',
  ])
  const TEXT_NOTNULL = new Set(['title'])
  const TEXT = new Set([
    'title',
    'location',
    'weather',
    'foremanText',
    'description',
    'eventsLeadingUp',
    'immediateActionTaken',
    'ppeWorn',
    'witnesses',
    'externalPeopleInvolved',
    'rootCause',
    'firstAidProvider',
    'firstAidNotes',
    'hospitalName',
    'treatedInCity',
    'transportation',
    'attendingPhysician',
    'molReportNumber',
    'policeReportNumber',
    'insuranceClaimNumber',
  ])

  const allowed =
    field in ENUMS ||
    NULLABLE_IDS.has(field) ||
    TS_REQUIRED.has(field) ||
    TS_NULLABLE.has(field) ||
    DATE_ONLY.has(field) ||
    INTS.has(field) ||
    NUMERICS.has(field) ||
    BOOLS.has(field) ||
    TEXT.has(field)
  if (!allowed) throw new Error('Field not allowed')

  // Locked incidents are read-only — mirror the legacy edit guard. Also re-scope
  // so a self/site-tier user can't edit an incident they cannot see.
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        locked: incidents.locked,
        reportedByTenantUserId: incidents.reportedByTenantUserId,
        siteOrgUnitId: incidents.siteOrgUnitId,
      })
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1)
    if (!row) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'incidents',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
    return visible ? row : null
  })
  if (!before) throw new Error('Incident not found')
  if (before.locked) throw new Error('Incident is locked')

  let val: unknown
  if (field in ENUMS) {
    if (!ENUMS[field]!.includes(value)) throw new Error('Invalid value')
    val = value
  } else if (NULLABLE_IDS.has(field)) {
    val = value || null
  } else if (TS_REQUIRED.has(field)) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
    val = d
  } else if (TS_NULLABLE.has(field)) {
    if (!value) val = null
    else {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
      val = d
    }
  } else if (DATE_ONLY.has(field)) {
    val = value || null
  } else if (INTS.has(field)) {
    if (value.trim() === '') val = null
    else {
      const n = Number.parseInt(value, 10)
      if (Number.isNaN(n)) throw new Error('Invalid number')
      val = n
    }
  } else if (NUMERICS.has(field)) {
    if (value.trim() === '') val = null
    else {
      if (Number.isNaN(Number(value))) throw new Error('Invalid number')
      val = value // numeric column — drizzle expects a string
    }
  } else if (BOOLS.has(field)) {
    val = value === 'true' || value === 'on' || value === '1'
  } else {
    // text
    const trimmed = value.trim()
    if (TEXT_NOTNULL.has(field) && trimmed === '') throw new Error('This field is required')
    val = trimmed === '' ? null : value
  }

  await ctx.db((tx) =>
    tx
      .update(incidents)
      .set({ [field]: val } as any)
      .where(eq(incidents.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/incidents/${id}`)
  revalidatePath('/incidents')
}

// ---- Photos, email, copy, delete -------------------------------------------

async function attachPhotos(incidentId: string, attachmentIds: string[]) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (attachmentIds.length === 0) return
  await assertCanSeeIncident(ctx, incidentId)
  await ctx.db(async (tx) => {
    const [incident] = await tx
      .select({ locked: incidents.locked })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)))
      .limit(1)
      .for('update')
    if (!incident) throw new Error('Incident not found')
    if (incident.locked) throw new Error('Incident is locked')
    const validIds = await validateTenantImageAttachmentIdsInTx(tx, ctx.tenantId, attachmentIds)
    const existing = await tx
      .select({
        attachmentId: incidentAttachments.attachmentId,
        sortOrder: incidentAttachments.sortOrder,
      })
      .from(incidentAttachments)
      .where(
        and(
          eq(incidentAttachments.tenantId, ctx.tenantId),
          eq(incidentAttachments.incidentId, incidentId),
        ),
      )
    const existingIds = new Set(existing.map((photo) => photo.attachmentId))
    const newAttachmentIds = validIds.filter((attachmentId) => !existingIds.has(attachmentId))
    if (newAttachmentIds.length === 0) return
    const baseSortOrder =
      existing.reduce((maximum, photo) => Math.max(maximum, photo.sortOrder), -1) + 1
    await tx.insert(incidentAttachments).values(
      newAttachmentIds.map((attachmentId, index) => ({
        tenantId: ctx.tenantId,
        incidentId,
        attachmentId,
        sortOrder: baseSortOrder + index,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: `Attached ${newAttachmentIds.length} photo${newAttachmentIds.length === 1 ? '' : 's'}`,
    })
  })
  revalidatePath(`/incidents/${incidentId}`)
}

async function updateIncidentPhoto(
  incidentId: string,
  photoId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (!isUuid(incidentId) || !isUuid(photoId)) return { ok: false, error: 'Photo not found.' }
  await assertCanSeeIncident(ctx, incidentId)
  const edits = parsePhotoEdits(input)
  const changed = await ctx.db(async (tx) => {
    const [incident] = await tx
      .select({ locked: incidents.locked })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)))
      .limit(1)
      .for('update')
    if (!incident) return false
    if (incident.locked) throw new Error('Incident is locked')
    const [photo] = await tx
      .select({ attachmentId: incidentAttachments.attachmentId })
      .from(incidentAttachments)
      .where(
        and(
          eq(incidentAttachments.tenantId, ctx.tenantId),
          eq(incidentAttachments.incidentId, incidentId),
          eq(incidentAttachments.id, photoId),
        ),
      )
      .limit(1)
      .for('update')
    if (!photo) return false
    await tx
      .update(incidentAttachments)
      .set({ caption: edits.caption })
      .where(
        and(
          eq(incidentAttachments.tenantId, ctx.tenantId),
          eq(incidentAttachments.incidentId, incidentId),
          eq(incidentAttachments.id, photoId),
        ),
      )
    await tx
      .update(attachments)
      .set({ annotations: edits.annotations })
      .where(
        and(
          eq(attachments.tenantId, ctx.tenantId),
          eq(attachments.id, photo.attachmentId),
          eq(attachments.kind, 'image'),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: 'Updated photo caption and markup',
      metadata: { photoId, annotationCount: edits.annotations?.length ?? 0 },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photo not found.' }
  revalidatePath(`/incidents/${incidentId}`)
  return { ok: true }
}

async function removeIncidentPhoto(
  incidentId: string,
  photoId: string,
): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (!isUuid(incidentId) || !isUuid(photoId)) return { ok: false, error: 'Photo not found.' }
  await assertCanSeeIncident(ctx, incidentId)
  const removed = await ctx.db(async (tx) => {
    const [incident] = await tx
      .select({ locked: incidents.locked })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)))
      .limit(1)
      .for('update')
    if (!incident) return false
    if (incident.locked) throw new Error('Incident is locked')
    const rows = await tx
      .delete(incidentAttachments)
      .where(
        and(
          eq(incidentAttachments.tenantId, ctx.tenantId),
          eq(incidentAttachments.incidentId, incidentId),
          eq(incidentAttachments.id, photoId),
        ),
      )
      .returning({ id: incidentAttachments.id })
    if (rows.length === 0) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: 'Removed photo',
      metadata: { photoId },
    })
    return true
  })
  if (!removed) return { ok: false, error: 'Photo not found.' }
  revalidatePath(`/incidents/${incidentId}`)
  return { ok: true }
}

async function reorderIncidentPhotos(
  incidentId: string,
  photoIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (
    !isUuid(incidentId) ||
    photoIds.some((photoId) => !isUuid(photoId)) ||
    new Set(photoIds).size !== photoIds.length
  ) {
    return { ok: false, error: 'Photo order is invalid.' }
  }
  await assertCanSeeIncident(ctx, incidentId)
  const changed = await ctx.db(async (tx) => {
    const [incident] = await tx
      .select({ locked: incidents.locked })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)))
      .limit(1)
      .for('update')
    if (!incident) return false
    if (incident.locked) throw new Error('Incident is locked')
    const current = await tx
      .select({ id: incidentAttachments.id })
      .from(incidentAttachments)
      .where(
        and(
          eq(incidentAttachments.tenantId, ctx.tenantId),
          eq(incidentAttachments.incidentId, incidentId),
        ),
      )
      .orderBy(
        asc(incidentAttachments.sortOrder),
        asc(incidentAttachments.createdAt),
        asc(incidentAttachments.id),
      )
      .for('update')
    const previousIds = current.map((photo) => photo.id)
    if (
      previousIds.length !== photoIds.length ||
      previousIds.some((photoId) => !photoIds.includes(photoId))
    ) {
      return false
    }
    if (previousIds.every((photoId, index) => photoId === photoIds[index])) return true
    for (const [sortOrder, photoId] of photoIds.entries()) {
      await tx
        .update(incidentAttachments)
        .set({ sortOrder })
        .where(
          and(
            eq(incidentAttachments.tenantId, ctx.tenantId),
            eq(incidentAttachments.incidentId, incidentId),
            eq(incidentAttachments.id, photoId),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: 'Reordered photos',
      before: { photoIds: previousIds },
      after: { photoIds },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photos changed before they could be reordered.' }
  revalidatePath(`/incidents/${incidentId}`)
  return { ok: true }
}

async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (
    !can(ctx, 'incidents.read.all') &&
    !can(ctx, 'incidents.read.site') &&
    !can(ctx, 'incidents.read.self')
  ) {
    throw new Error('Not authorized')
  }
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await assertCanSeeIncident(ctx, id)
  const subjectPrefix = String(formData.get('subjectPrefix') ?? '').trim() || undefined
  const messageOverride = String(formData.get('message') ?? '').trim() || undefined
  const recipients = String(formData.get('recipients') ?? '')
    .split(/[,;\s]+/g)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  if (recipients.length === 0) throw new Error('Add at least one valid email address')
  await sendIncidentEmail(ctx, id, { subjectPrefix, messageOverride, recipients })
  revalidatePath(`/incidents/${id}`)
}

async function copyIncident(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.create')
  const sourceId = String(formData.get('id') ?? '')
  if (!sourceId) return
  const titleOverride = String(formData.get('title') ?? '').trim()
  const src = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, sourceId)).limit(1)
    if (!row) return null
    // Re-scope the source record: a self/site-tier user must be able to see the
    // incident they are cloning from.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'incidents',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
    return visible ? row : null
  })
  if (!src) return

  const [row] = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'incident')
    return tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type: src.type,
        severity: src.severity,
        status: 'reported',
        title: titleOverride || `Copy of ${src.title}`,
        description: src.description,
        occurredAt: new Date(),
        siteOrgUnitId: src.siteOrgUnitId,
        location: src.location,
        weather: src.weather,
        departmentId: src.departmentId,
        supervisorPersonId: src.supervisorPersonId,
        foremanText: src.foremanText,
        externalPeopleInvolved: src.externalPeopleInvolved,
        ppeWorn: src.ppeWorn,
        classificationId: src.classificationId,
        reportedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning()
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: row.id,
      action: 'create',
      summary: `Cloned from ${src.reference}`,
      after: { reference: row.reference, sourceId: src.id },
    })
    revalidatePath('/incidents')
    redirect(`/incidents/${row.id}`)
  }
}

async function deleteIncident(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!canManageModule(ctx, 'incidents')) throw new Error('Not authorized')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(incidents).set({ deletedAt: new Date() }).where(eq(incidents.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'delete',
    summary: 'Deleted incident',
  })
  revalidatePath('/incidents')
  redirect('/incidents')
}

// ---- People involved -------------------------------------------------------

async function saveIncidentPerson(input: PersonInput): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (!input.incidentId) return { ok: false, error: 'Missing incident.' }
  if (!input.personId && !input.personNameText)
    return { ok: false, error: 'Pick a person or type a name.' }
  await assertCanSeeIncident(ctx, input.incidentId)
  if (input.id) {
    await ctx.db((tx) =>
      tx
        .update(incidentPeople)
        .set({
          personId: input.personId,
          personNameText: input.personNameText,
          role: input.role,
        })
        .where(eq(incidentPeople.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: 'Edited person involved',
    })
  } else {
    await ctx.db((tx) =>
      tx.insert(incidentPeople).values({
        tenantId: ctx.tenantId,
        incidentId: input.incidentId,
        personId: input.personId,
        personNameText: input.personNameText,
        role: input.role,
      }),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: 'Added person involved',
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deleteIncidentPerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  await ctx.db((tx) => tx.delete(incidentPeople).where(eq(incidentPeople.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: 'Removed person involved',
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Injuries --------------------------------------------------------------

class IncidentInjuryMutationError extends Error {}

async function saveIncidentInjury(input: InjuryInput): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')

  let parsed: ReturnType<typeof parseIncidentInjuryInput>
  try {
    parsed = parseIncidentInjuryInput(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Injury is invalid.' }
  }

  await assertCanSeeIncident(ctx, parsed.incidentId)
  const values = {
    personId: parsed.personId,
    personName: parsed.personName,
    injuryResult: parsed.injuryResult,
    bodyParts: parsed.bodyParts,
    treatment: parsed.treatment,
    treatedAtFacility: parsed.treatedAtFacility,
    workedHoursPriorTo: parsed.workedHoursPriorTo,
  }

  try {
    await ctx.db(async (tx) => {
      const [incident] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, ctx.tenantId),
            eq(incidents.id, parsed.incidentId),
            isNull(incidents.deletedAt),
          ),
        )
        .limit(1)
      if (!incident) throw new IncidentInjuryMutationError('Incident not found.')

      const [before] = parsed.id
        ? await tx
            .select()
            .from(incidentInjuries)
            .where(
              and(
                eq(incidentInjuries.tenantId, ctx.tenantId),
                eq(incidentInjuries.id, parsed.id),
                eq(incidentInjuries.incidentId, parsed.incidentId),
              ),
            )
            .limit(1)
        : []
      if (parsed.id && !before) {
        throw new IncidentInjuryMutationError('Injury not found on this incident.')
      }

      if (parsed.personId) {
        const [person] = await tx
          .select({ id: people.id })
          .from(people)
          .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, parsed.personId)))
          .limit(1)
        if (!person) throw new IncidentInjuryMutationError('Injured person not found.')
      }

      const existingAssignments = parsed.id
        ? await tx
            .select({ injuryTypeId: incidentInjuryTypeAssignments.injuryTypeId })
            .from(incidentInjuryTypeAssignments)
            .where(
              and(
                eq(incidentInjuryTypeAssignments.tenantId, ctx.tenantId),
                eq(incidentInjuryTypeAssignments.injuryId, parsed.id),
              ),
            )
        : []
      const existingTypeIds = new Set(existingAssignments.map((row) => row.injuryTypeId))

      if (parsed.injuryTypeIds.length > 0) {
        const selectedTypes = await tx
          .select({
            id: incidentInjuryTypes.id,
            isActive: incidentInjuryTypes.isActive,
            deletedAt: incidentInjuryTypes.deletedAt,
          })
          .from(incidentInjuryTypes)
          .where(
            and(
              eq(incidentInjuryTypes.tenantId, ctx.tenantId),
              inArray(incidentInjuryTypes.id, parsed.injuryTypeIds),
            ),
          )
        const selectedById = new Map(selectedTypes.map((row) => [row.id, row]))
        for (const typeId of parsed.injuryTypeIds) {
          const type = selectedById.get(typeId)
          if (!type) throw new IncidentInjuryMutationError('An injury type was not found.')
          if ((type.deletedAt || type.isActive !== 1) && !existingTypeIds.has(typeId)) {
            throw new IncidentInjuryMutationError('Archived injury types cannot be newly assigned.')
          }
        }
      }

      let injuryId: string
      if (before && parsed.id) {
        const [updated] = await tx
          .update(incidentInjuries)
          .set(values)
          .where(
            and(
              eq(incidentInjuries.tenantId, ctx.tenantId),
              eq(incidentInjuries.id, parsed.id),
              eq(incidentInjuries.incidentId, parsed.incidentId),
            ),
          )
          .returning({ id: incidentInjuries.id })
        if (!updated) throw new IncidentInjuryMutationError('Injury could not be updated.')
        injuryId = updated.id
      } else {
        const [created] = await tx
          .insert(incidentInjuries)
          .values({
            tenantId: ctx.tenantId,
            incidentId: parsed.incidentId,
            ...values,
          })
          .returning({ id: incidentInjuries.id })
        if (!created) throw new IncidentInjuryMutationError('Injury could not be created.')
        injuryId = created.id
      }

      await tx
        .delete(incidentInjuryTypeAssignments)
        .where(
          and(
            eq(incidentInjuryTypeAssignments.tenantId, ctx.tenantId),
            eq(incidentInjuryTypeAssignments.injuryId, injuryId),
          ),
        )
      if (parsed.injuryTypeIds.length > 0) {
        await tx.insert(incidentInjuryTypeAssignments).values(
          parsed.injuryTypeIds.map((injuryTypeId) => ({
            tenantId: ctx.tenantId,
            injuryId,
            injuryTypeId,
          })),
        )
      }

      await recordAuditInTransaction(tx, ctx, {
        entityType: 'incident',
        entityId: parsed.incidentId,
        action: 'update',
        summary: before ? 'Edited injury' : 'Added injury',
        before: before
          ? {
              personId: before.personId,
              personName: before.personName,
              injuryTypeIds: [...existingTypeIds],
              injuryResult: before.injuryResult,
              bodyParts: before.bodyParts,
              treatment: before.treatment,
              treatedAtFacility: before.treatedAtFacility,
              workedHoursPriorTo: before.workedHoursPriorTo,
            }
          : null,
        after: { ...values, injuryTypeIds: parsed.injuryTypeIds },
      })
    })
  } catch (error) {
    if (error instanceof IncidentInjuryMutationError) return { ok: false, error: error.message }
    throw error
  }

  revalidatePath(`/incidents/${parsed.incidentId}`)
  return { ok: true }
}

async function deleteIncidentInjury(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!isUuid(id) || !isUuid(incidentId)) return
  await assertCanSeeIncident(ctx, incidentId)
  await ctx.db(async (tx) => {
    const [deleted] = await tx
      .delete(incidentInjuries)
      .where(
        and(
          eq(incidentInjuries.tenantId, ctx.tenantId),
          eq(incidentInjuries.id, id),
          eq(incidentInjuries.incidentId, incidentId),
        ),
      )
      .returning({ id: incidentInjuries.id })
    if (!deleted) return
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: 'Removed injury',
    })
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Lost-time events ------------------------------------------------------

async function addLostTimeEvent(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const incidentId = String(formData.get('incidentId') ?? '')
  const status = String(formData.get('status') ?? '') as
    'off_work' | 'restricted_duty' | 'full_duty'
  const validFrom = String(formData.get('validFrom') ?? '').trim()
  const validTo = String(formData.get('validTo') ?? '').trim() || null
  const injuryId = String(formData.get('injuryId') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!incidentId || !validFrom) return
  if (!['off_work', 'restricted_duty', 'full_duty'].includes(status)) return
  assertCan(ctx, 'incidents.update')
  await assertCanSeeIncident(ctx, incidentId)

  const [row] = await ctx.db((tx) =>
    tx
      .insert(incidentLostTimeEvents)
      .values({
        tenantId: ctx.tenantId,
        incidentId,
        injuryId,
        status,
        validFrom,
        validTo,
        notes,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: incidentId,
      action: 'update',
      summary: `Added lost-time row (${status.replace(/_/g, ' ')}, from ${validFrom})`,
      after: { status, validFrom, validTo, injuryId },
    })
  }
  revalidatePath(`/incidents/${incidentId}`)
  redirect(`/incidents/${incidentId}#section-lost-time`)
}

async function deleteLostTimeEvent(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentLostTimeEvents)
      .where(eq(incidentLostTimeEvents.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) => tx.delete(incidentLostTimeEvents).where(eq(incidentLostTimeEvents.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed lost-time row (${before.status.replace(/_/g, ' ')}, from ${before.validFrom})`,
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Investigation: events --------------------------------------------------

async function saveEventAction(input: {
  id?: string
  incidentId: string
  occurredAt: string
  description: string
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const desc = input.description.trim()
  if (!input.incidentId || !desc) return { ok: false, error: 'Description is required.' }
  if (!input.occurredAt) return { ok: false, error: 'Timestamp is required.' }
  const occurred = new Date(input.occurredAt)
  if (Number.isNaN(occurred.getTime())) return { ok: false, error: 'Invalid timestamp.' }
  await assertCanSeeIncident(ctx, input.incidentId)

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentEvents)
        .where(eq(incidentEvents.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Event not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentEvents)
        .set({ occurredAt: occurred, description: desc })
        .where(eq(incidentEvents.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: `Edited timeline event`,
      before: { occurredAt: before.occurredAt, description: before.description },
      after: { occurredAt: occurred, description: desc },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentEvents)
        .values({
          tenantId: ctx.tenantId,
          incidentId: input.incidentId,
          occurredAt: occurred,
          recordedByTenantUserId: ctx.membership?.id ?? null,
          description: desc,
        })
        .returning(),
    )
    if (!row) return { ok: false, error: 'Failed to insert event.' }
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'create',
      summary: `Added timeline event`,
      after: { occurredAt: occurred, description: desc },
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deleteEvent(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  const before = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(incidentEvents).where(eq(incidentEvents.id, id)).limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) => tx.delete(incidentEvents).where(eq(incidentEvents.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed timeline event`,
    before: { occurredAt: before.occurredAt, description: before.description },
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Investigation: contributing factors ------------------------------------

async function saveFactorAction(input: {
  id?: string
  incidentId: string
  category: FactorCategory
  description: string
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const desc = input.description.trim()
  if (!input.incidentId || !desc) return { ok: false, error: 'Description is required.' }
  if (!FACTOR_CATEGORIES.includes(input.category)) return { ok: false, error: 'Invalid category.' }
  await assertCanSeeIncident(ctx, input.incidentId)

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentContributingFactors)
        .where(eq(incidentContributingFactors.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Factor not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentContributingFactors)
        .set({ category: input.category, description: desc })
        .where(eq(incidentContributingFactors.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: `Edited contributing factor (${input.category})`,
      before: { category: before.category, description: before.description },
      after: { category: input.category, description: desc },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentContributingFactors)
        .values({
          tenantId: ctx.tenantId,
          incidentId: input.incidentId,
          category: input.category,
          description: desc,
        })
        .returning(),
    )
    if (!row) return { ok: false, error: 'Failed to insert factor.' }
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'create',
      summary: `Added contributing factor (${input.category})`,
      after: { category: input.category, description: desc },
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deleteFactor(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentContributingFactors)
      .where(eq(incidentContributingFactors.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) =>
    tx.delete(incidentContributingFactors).where(eq(incidentContributingFactors.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed contributing factor (${before.category})`,
    before: { category: before.category, description: before.description },
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Investigation: root-cause whys -----------------------------------------

async function saveWhyAction(input: {
  id?: string
  incidentId: string
  ordinal: number
  whyText: string
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const text = input.whyText.trim()
  if (!input.incidentId || !text) return { ok: false, error: 'Why text is required.' }
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > 5)
    return { ok: false, error: 'Ordinal must be between 1 and 5.' }
  await assertCanSeeIncident(ctx, input.incidentId)

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentRootCauseWhys)
        .where(eq(incidentRootCauseWhys.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Why step not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentRootCauseWhys)
        .set({ ordinal: input.ordinal, whyText: text })
        .where(eq(incidentRootCauseWhys.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: `Edited "why" step #${input.ordinal}`,
      before: { ordinal: before.ordinal, whyText: before.whyText },
      after: { ordinal: input.ordinal, whyText: text },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentRootCauseWhys)
        .values({
          tenantId: ctx.tenantId,
          incidentId: input.incidentId,
          ordinal: input.ordinal,
          whyText: text,
        })
        .returning(),
    )
    if (!row) return { ok: false, error: 'Failed to insert why step.' }
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'create',
      summary: `Added "why" step #${input.ordinal}`,
      after: { ordinal: input.ordinal, whyText: text },
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deleteWhy(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentRootCauseWhys)
      .where(eq(incidentRootCauseWhys.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) => tx.delete(incidentRootCauseWhys).where(eq(incidentRootCauseWhys.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed "why" step #${before.ordinal}`,
    before: { ordinal: before.ordinal, whyText: before.whyText },
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Investigation: preventative steps --------------------------------------

async function savePrevStepAction(input: {
  id?: string
  incidentId: string
  description: string
  ownerPersonId: string | null
  targetDate: string | null
  status: PrevStepStatus
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const desc = input.description.trim()
  if (!input.incidentId || !desc) return { ok: false, error: 'Description is required.' }
  if (!PREV_STEP_STATUSES.includes(input.status)) return { ok: false, error: 'Invalid status.' }
  await assertCanSeeIncident(ctx, input.incidentId)

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentPreventativeSteps)
        .where(eq(incidentPreventativeSteps.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Preventative step not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentPreventativeSteps)
        .set({
          description: desc,
          ownerPersonId: input.ownerPersonId,
          targetDate: input.targetDate,
          status: input.status,
        })
        .where(eq(incidentPreventativeSteps.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: `Edited preventative step (${input.status.replace(/_/g, ' ')})`,
      before: {
        description: before.description,
        ownerPersonId: before.ownerPersonId,
        targetDate: before.targetDate,
        status: before.status,
      },
      after: {
        description: desc,
        ownerPersonId: input.ownerPersonId,
        targetDate: input.targetDate,
        status: input.status,
      },
    })
  } else {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(incidentPreventativeSteps)
        .values({
          tenantId: ctx.tenantId,
          incidentId: input.incidentId,
          description: desc,
          ownerPersonId: input.ownerPersonId,
          targetDate: input.targetDate,
          status: input.status,
        })
        .returning(),
    )
    if (!row) return { ok: false, error: 'Failed to insert preventative step.' }
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'create',
      summary: `Added preventative step (${input.status.replace(/_/g, ' ')})`,
      after: {
        description: desc,
        ownerPersonId: input.ownerPersonId,
        targetDate: input.targetDate,
        status: input.status,
      },
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deletePrevStep(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.investigate')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentPreventativeSteps)
      .where(eq(incidentPreventativeSteps.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) =>
    tx.delete(incidentPreventativeSteps).where(eq(incidentPreventativeSteps.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed preventative step`,
    before: { description: before.description, status: before.status },
  })
  revalidatePath(`/incidents/${incidentId}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_001c9883846976', { value0: id.slice(0, 8) }) }
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const regulatoryT = await getTranslations('Regulatory')
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.editId)
  const ctx = await requireRequestContext()
  const regulatory = getRegulatoryTerminology(ctx)
  const pendingGates = await getPendingFlowGatesForSubject(
    ctx,
    'module',
    id,
    canManageSubjectGates(ctx, 'module', 'incidents'),
  )

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        incident: incidents,
        site: orgUnits,
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(and(eq(incidents.id, id), isNull(incidents.deletedAt)))
      .limit(1)
    if (!row) return null
    const injuries = await tx
      .select({ injury: incidentInjuries, person: people })
      .from(incidentInjuries)
      .leftJoin(people, eq(people.id, incidentInjuries.personId))
      .where(eq(incidentInjuries.incidentId, id))
      .orderBy(asc(incidentInjuries.createdAt))
    const injuryIds = injuries.map((row) => row.injury.id)
    const injuryTypeRows =
      injuryIds.length === 0
        ? []
        : await tx
            .select({
              injuryId: incidentInjuryTypeAssignments.injuryId,
              id: incidentInjuryTypes.id,
              name: incidentInjuryTypes.name,
            })
            .from(incidentInjuryTypeAssignments)
            .innerJoin(
              incidentInjuryTypes,
              and(
                eq(incidentInjuryTypes.tenantId, incidentInjuryTypeAssignments.tenantId),
                eq(incidentInjuryTypes.id, incidentInjuryTypeAssignments.injuryTypeId),
              ),
            )
            .where(
              and(
                eq(incidentInjuryTypeAssignments.tenantId, ctx.tenantId),
                inArray(incidentInjuryTypeAssignments.injuryId, injuryIds),
              ),
            )
            .orderBy(asc(incidentInjuryTypes.sortOrder), asc(incidentInjuryTypes.name))
    const assignedTypesByInjury = new Map<string, { id: string; name: string }[]>()
    for (const row of injuryTypeRows) {
      const assigned = assignedTypesByInjury.get(row.injuryId) ?? []
      assigned.push({ id: row.id, name: row.name })
      assignedTypesByInjury.set(row.injuryId, assigned)
    }
    const injuriesWithTypes = injuries.map((row) => ({
      ...row,
      assignedTypes: assignedTypesByInjury.get(row.injury.id) ?? [],
    }))
    const lostTime = await tx
      .select()
      .from(incidentLostTimeEvents)
      .where(eq(incidentLostTimeEvents.incidentId, id))
      .orderBy(asc(incidentLostTimeEvents.validFrom))
    const involved = await tx
      .select({ link: incidentPeople, person: people })
      .from(incidentPeople)
      .leftJoin(people, eq(people.id, incidentPeople.personId))
      .where(eq(incidentPeople.incidentId, id))
      .orderBy(asc(incidentPeople.createdAt))
    const linkedCAs = await tx
      .select()
      .from(correctiveActions)
      .where(
        and(
          eq(correctiveActions.sourceEntityType, 'incident'),
          eq(correctiveActions.sourceEntityId, id),
        ),
      )
    const photos = await tx
      .select({ link: incidentAttachments, attachment: attachments })
      .from(incidentAttachments)
      .innerJoin(attachments, eq(attachments.id, incidentAttachments.attachmentId))
      .where(eq(incidentAttachments.incidentId, id))
      .orderBy(
        asc(incidentAttachments.sortOrder),
        asc(incidentAttachments.createdAt),
        asc(incidentAttachments.id),
      )
    const timelineEvents = await tx
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, id))
      .orderBy(asc(incidentEvents.occurredAt))
    const factors = await tx
      .select()
      .from(incidentContributingFactors)
      .where(eq(incidentContributingFactors.incidentId, id))
      .orderBy(
        asc(incidentContributingFactors.category),
        desc(incidentContributingFactors.createdAt),
      )
    const whys = await tx
      .select()
      .from(incidentRootCauseWhys)
      .where(eq(incidentRootCauseWhys.incidentId, id))
      .orderBy(asc(incidentRootCauseWhys.ordinal))
    const prevSteps = await tx
      .select({ step: incidentPreventativeSteps, owner: people })
      .from(incidentPreventativeSteps)
      .leftJoin(people, eq(people.id, incidentPreventativeSteps.ownerPersonId))
      .where(eq(incidentPreventativeSteps.incidentId, id))
      .orderBy(asc(incidentPreventativeSteps.status), asc(incidentPreventativeSteps.targetDate))

    return {
      ...row,
      injuries: injuriesWithTypes,
      lostTime,
      involved,
      linkedCAs,
      photos,
      timelineEvents,
      factors,
      whys,
      prevSteps,
    }
  })

  if (!data) notFound()
  // Per-user record visibility: don't expose an incident the viewer may not see
  // (read.all → any; read.site → my sites; else → ones I reported).
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'incidents',
        ownerIds: [data.incident.reportedByTenantUserId],
        siteId: data.incident.siteOrgUnitId,
      }),
    ))
  )
    notFound()
  const {
    incident,
    site,
    injuries,
    lostTime,
    involved,
    linkedCAs,
    photos,
    timelineEvents,
    factors,
    whys,
    prevSteps,
  } = data

  const canManage = canManageModule(ctx, 'incidents')
  const locked = incident.locked
  const activity = await recentActivityForEntity(ctx, 'incident', id, 25)

  // Smallest unused ordinal (1..5) for adding a new "why" row.
  const usedOrdinals = new Set(whys.map((w) => w.ordinal))
  const nextWhyOrdinal = [1, 2, 3, 4, 5].find((n) => !usedOrdinals.has(n)) ?? 5

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    attachmentId: p.attachment.id,
    url: attachmentUrl(p.attachment.id),
    filename: p.attachment.filename,
    caption: p.link.caption,
    annotations: p.attachment.annotations,
    width: p.attachment.width,
    height: p.attachment.height,
  }))
  const updateIncidentPhotoAction = updateIncidentPhoto.bind(null, id)
  const removeIncidentPhotoAction = removeIncidentPhoto.bind(null, id)
  const reorderIncidentPhotosAction = reorderIncidentPhotos.bind(null, id)

  // Investigation-progress milestones — drive the overview hero + checklist.
  const milestones = [
    {
      label: 'Details captured',
      done: Boolean(incident.title && incident.occurredAt && incident.siteOrgUnitId),
    },
    { label: 'People & injuries', done: involved.length > 0 || injuries.length > 0 },
    { label: 'Timeline reconstructed', done: timelineEvents.length > 0 },
    { label: 'Causes identified', done: factors.length > 0 },
    { label: 'Root cause determined', done: Boolean(incident.rootCause) || whys.length > 0 },
    { label: 'Preventative steps', done: prevSteps.length > 0 },
    { label: 'Closed', done: incident.status === 'closed' },
  ]
  const doneCount = milestones.filter((m) => m.done).length
  const pct = Math.round((doneCount / milestones.length) * 100)
  const ringCirc = 2 * Math.PI * 26

  const investigationCount =
    timelineEvents.length + factors.length + whys.length + prevSteps.length + linkedCAs.length

  const sectionItems: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'people', label: 'People', count: involved.length },
    { id: 'medical', label: 'Medical' },
    { id: 'injuries', label: 'Injuries', count: injuries.length },
    { id: 'metrics', label: 'Key metrics' },
    { id: 'lost-time', label: 'Lost time', count: lostTime.length },
    { id: 'investigation', label: 'Investigation', count: investigationCount },
    { id: 'photos', label: 'Photos', count: photos.length },
    { id: 'activity', label: 'Activity', count: activity.length },
  ]

  const basePath = `/incidents/${id}`
  const drawerHref = (key: string, extra?: Record<string, string>) => {
    const qp = new URLSearchParams()
    qp.set('drawer', key)
    if (extra) for (const [k, v] of Object.entries(extra)) qp.set(k, v)
    return `${basePath}?${qp.toString()}`
  }

  // Edit-target lookups for the URL-driven drawers.
  const editPersonRow =
    drawer === 'edit-person' && editId ? involved.find((r) => r.link.id === editId) : undefined
  const editInjuryRow =
    drawer === 'edit-injury' && editId ? injuries.find((r) => r.injury.id === editId) : undefined
  const editingEvent =
    drawer === 'edit-event' && editId ? timelineEvents.find((e) => e.id === editId) : undefined
  const editingFactor =
    drawer === 'edit-factor' && editId ? factors.find((f) => f.id === editId) : undefined
  const editingWhy = drawer === 'edit-why' && editId ? whys.find((w) => w.id === editId) : undefined
  const editingPrev =
    drawer === 'edit-prev-step' && editId
      ? prevSteps.find((r) => r.step.id === editId)?.step
      : undefined

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/incidents', label: 'Back to incidents' }}
          title={tGeneratedValue(incident.title)}
          subtitle={tGenerated('m_0e692e63774c58', {
            value0: incident.reference,
            value1: formatRel(incident.reportedAt, ctx.timezone, ctx.locale),
          })}
          badge={
            <div className="flex items-center gap-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              <GeneratedValue
                value={
                  locked ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-800">
                      <Lock size={10} /> <GeneratedText id="m_0e259fa0babc2d" />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
          actions={
            <IncidentHeaderActions
              id={id}
              status={incident.status}
              statuses={STATUSES}
              locked={locked}
              canManage={canManage}
              pdfHref={`${basePath}/pdf`}
              emailHref={drawerHref('send-email')}
              copyHref={drawerHref('copy')}
              deleteHref={drawerHref('confirm-delete')}
              updateStatusAction={updateStatus}
              toggleLockAction={toggleLock}
            />
          }
        />
      }
      alerts={
        <>
          <GeneratedValue
            value={
              locked ? (
                <Alert variant="warning">
                  <AlertTitle>
                    <GeneratedText id="m_0580b66aed3ff1" />
                  </AlertTitle>
                  <AlertDescription className="flex items-center justify-between">
                    <span>
                      <GeneratedText id="m_01381607e25f0d" />
                      <GeneratedValue value={' '} />
                      <GeneratedValue
                        value={
                          incident.closedAt
                            ? formatDate(new Date(incident.closedAt), ctx.timezone, ctx.locale)
                            : '—'
                        }
                      />
                      <GeneratedText id="m_02ee203c91c623" />
                    </span>
                    <form action={toggleLock} className="inline">
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="lock" value="false" />
                      <Button variant="outline" size="sm" type="submit">
                        <Unlock size={12} /> <GeneratedText id="m_0ca830c9381fd6" />
                      </Button>
                    </form>
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <GeneratedValue
            value={
              incident.criticalInjury || incident.ministryOfLabourNotified ? (
                <Alert variant="destructive">
                  <AlertTriangle size={16} />
                  <AlertTitle>
                    <GeneratedText id="m_0963d480ff963a" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue
                      value={incident.criticalInjury ? <GeneratedText id="m_0df328fb5ce73a" /> : ''}
                    />
                    <GeneratedValue
                      value={
                        incident.ministryOfLabourNotified ? (
                          <GeneratedValue
                            value={regulatoryT('authorityWasNotified', {
                              authority: regulatory.authorityName,
                            })}
                          />
                        ) : (
                          ''
                        )
                      }
                    />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="space-y-5">
        <GeneratedValue
          value={pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}
        />
        {/* ===================== OVERVIEW ===================== */}
        <section id="section-overview" className="scroll-mt-2 space-y-5">
          {/* Hero — investigation progress ring */}
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
                  <GeneratedValue value={incident.type.replace(/_/g, ' ')} />
                  <GeneratedValue value={site ? ` · ${site.name}` : ''} />
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
            title={tGenerated('m_062cdc4673a07a')}
            subtitle={tGenerated('m_1cf9885ac52ebd')}
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <LiveSelect
                id={id}
                field="type"
                label={tGenerated('m_074ba2f160c506')}
                initialValue={incident.type}
                allowEmpty={false}
                options={TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="severity"
                label={tGenerated('m_168b365cc671bf')}
                initialValue={incident.severity}
                allowEmpty={false}
                options={SEVERITIES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <div className="sm:col-span-2">
                <LiveField
                  id={id}
                  field="title"
                  label={tGenerated('m_0decefd558c355')}
                  initialValue={incident.title}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveDateTime
                id={id}
                field="occurredAt"
                label={tGenerated('m_03f174df92cf82')}
                initialValue={toLocalDatetime(incident.occurredAt)}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="siteOrgUnitId"
                label={tGenerated('m_020146dd3d3d5a')}
                initialValue={incident.siteOrgUnitId}
                lookup="incident-sites"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="departmentId"
                label={tGenerated('m_1af68228b8305a')}
                initialValue={incident.departmentId}
                lookup="incident-departments"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="classificationId"
                label={tGenerated('m_08405fc4ea6181')}
                initialValue={incident.classificationId}
                lookup="incident-classifications"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="location"
                label={tGenerated('m_0300804afcc3bb')}
                initialValue={incident.location}
                placeholder={tGenerated('m_09265e43b4c31c')}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="weather"
                label={tGenerated('m_0ac9b805dc5093')}
                initialValue={incident.weather}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRemoteSelect
                id={id}
                field="supervisorPersonId"
                label={tGenerated('m_0ccb8e5b917b17')}
                initialValue={incident.supervisorPersonId}
                lookup="incident-people"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="foremanText"
                label={tGenerated('m_184fa8d9234543')}
                initialValue={incident.foremanText}
                disabled={locked}
                updateAction={updateTextField}
              />
            </div>
          </Section>

          <Section
            title={tGenerated('m_19cd2240015167')}
            subtitle={tGenerated('m_01648e08263dfe')}
            icon={<FileText size={20} />}
            tone="slate"
          >
            <div className="space-y-4">
              <LiveRichText
                id={id}
                field="eventsLeadingUp"
                label={tGenerated('m_19b47bcc915bf0')}
                initialValue={incident.eventsLeadingUp}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="description"
                label={tGenerated('m_0f069fc711163d')}
                initialValue={incident.description}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="immediateActionTaken"
                label={tGenerated('m_1ea890e56aa6ae')}
                initialValue={incident.immediateActionTaken}
                disabled={locked}
                updateAction={updateTextField}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LiveRichText
                  id={id}
                  field="witnesses"
                  label={tGenerated('m_0c5ffecfcfc329')}
                  initialValue={incident.witnesses}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveRichText
                  id={id}
                  field="externalPeopleInvolved"
                  label={tGenerated('m_03283bb876874a')}
                  initialValue={incident.externalPeopleInvolved}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveField
                id={id}
                field="ppeWorn"
                label={tGenerated('m_1bb5a963312ef4')}
                initialValue={incident.ppeWorn}
                disabled={locked}
                updateAction={updateTextField}
              />
            </div>
          </Section>
        </section>

        {/* ===================== PEOPLE ===================== */}
        <section id="section-people" className="scroll-mt-2">
          <Section
            title={tGenerated('m_17da6c84e50d2b', { value0: involved.length })}
            subtitle={tGenerated('m_1fe4bb08dc904f')}
            icon={<Users size={20} />}
            tone="teal"
            actions={
              !locked ? (
                <Link href={drawerHref('add-person') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> <GeneratedText id="m_12634c941f2fb6" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                involved.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_0a0b84eea0d527')}
                    description={tGenerated('m_172961b4da5b86')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={involved.map((row) => (
                        <li
                          key={row.link.id}
                          className="group flex items-center justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedValue
                                value={
                                  row.person ? (
                                    <Link
                                      href={`/people/${row.person.id}`}
                                      className="hover:underline"
                                    >
                                      <GeneratedValue value={row.person.firstName} />{' '}
                                      <GeneratedValue value={row.person.lastName} />
                                    </Link>
                                  ) : (
                                    (row.link.personNameText ?? '—')
                                  )
                                }
                              />
                            </div>
                            <GeneratedValue
                              value={
                                row.link.role ? (
                                  <Badge variant="outline" className="mt-1 capitalize">
                                    <GeneratedValue value={row.link.role} />
                                  </Badge>
                                ) : null
                              }
                            />
                          </div>
                          <GeneratedValue
                            value={
                              !locked ? (
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                  <Link
                                    href={drawerHref('edit-person', { editId: row.link.id }) as any}
                                    scroll={false}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                    title={tGenerated('m_15a58e7a50ce9f')}
                                  >
                                    <Pencil size={14} />
                                  </Link>
                                  <form action={deleteIncidentPerson} className="inline">
                                    <input type="hidden" name="id" value={row.link.id} />
                                    <input type="hidden" name="incidentId" value={id} />
                                    <button
                                      type="submit"
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                      title={tGenerated('m_0861fceae96945')}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </form>
                                </div>
                              ) : null
                            }
                          />
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>
        </section>

        {/* ===================== MEDICAL ===================== */}
        <section id="section-medical" className="scroll-mt-2">
          <Section
            title={tGenerated('m_11127230209c9b')}
            subtitle={tGenerated('m_1f15a4b3321f8b')}
            icon={<HeartPulse size={20} />}
            tone="rose"
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <LiveToggle
                  id={id}
                  field="criticalInjury"
                  label={tGenerated('m_145ad4ecccb8ca')}
                  initialValue={incident.criticalInjury}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="ministryOfLabourNotified"
                  label={regulatoryT('authorityNotified', {
                    authority: regulatory.authorityName,
                  })}
                  initialValue={incident.ministryOfLabourNotified}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="emsCalled"
                  label={tGenerated('m_09081dea5ec5bb')}
                  initialValue={incident.emsCalled}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="firstAidGiven"
                  label={tGenerated('m_0d7228f1689c59')}
                  initialValue={incident.firstAidGiven}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="medicalAttentionReceived"
                  label={tGenerated('m_1916246f33213b')}
                  initialValue={incident.medicalAttentionReceived}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="lostTime"
                  label={tGenerated('m_07762fdb1dad26')}
                  initialValue={incident.lostTime}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="modifiedDuty"
                  label={tGenerated('m_18f9bcad979f3b')}
                  initialValue={incident.modifiedDuty}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="externallyReportable"
                  label={tGenerated('m_0ace4bcf5de488')}
                  initialValue={incident.externallyReportable}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="policeNotified"
                  label={tGenerated('m_1fec1e8f5877cf')}
                  initialValue={incident.policeNotified}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>

              <GeneratedValue
                value={
                  incident.emsCalled ? (
                    <SubBlock title={tGenerated('m_09abf0df23f312')} tone="rose">
                      <LiveDateTime
                        id={id}
                        field="emsArrivedAt"
                        label={tGenerated('m_03ccee6c33c3d1')}
                        initialValue={
                          incident.emsArrivedAt ? toLocalDatetime(incident.emsArrivedAt) : ''
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.firstAidGiven ? (
                    <SubBlock title={tGenerated('m_1b39b28001ff31')} tone="amber">
                      <LiveField
                        id={id}
                        field="firstAidProvider"
                        label={tGenerated('m_03ec9dccb4df6b')}
                        initialValue={incident.firstAidProvider}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="firstAidNotes"
                        label={tGenerated('m_1c76ce6357cc6a')}
                        initialValue={incident.firstAidNotes}
                        multiline
                        rows={2}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.medicalAttentionReceived ? (
                    <SubBlock title={tGenerated('m_170bb2c39aeda0')} tone="sky">
                      <LiveField
                        id={id}
                        field="hospitalName"
                        label={tGenerated('m_14ed8013ab807e')}
                        initialValue={incident.hospitalName}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="treatedInCity"
                        label={tGenerated('m_0f8706f757eeb9')}
                        initialValue={incident.treatedInCity}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="transportation"
                        label={tGenerated('m_02abf0d6ea0266')}
                        initialValue={incident.transportation}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="attendingPhysician"
                        label={tGenerated('m_14695b7ef536e2')}
                        initialValue={incident.attendingPhysician}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveDateTime
                        id={id}
                        field="hospitalArrivedAt"
                        label={tGenerated('m_00223fd1544992')}
                        initialValue={
                          incident.hospitalArrivedAt
                            ? toLocalDatetime(incident.hospitalArrivedAt)
                            : ''
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveDateTime
                        id={id}
                        field="dischargedAt"
                        label={tGenerated('m_17539cf3f6e833')}
                        initialValue={
                          incident.dischargedAt ? toLocalDatetime(incident.dischargedAt) : ''
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.ministryOfLabourNotified ? (
                    <SubBlock title={regulatory.authorityName} tone="orange">
                      <LiveDateTime
                        id={id}
                        field="molNotifiedAt"
                        label={regulatoryT('authorityNotifiedAt', {
                          abbreviation: regulatory.authorityAbbreviation,
                        })}
                        initialValue={
                          incident.molNotifiedAt ? toLocalDatetime(incident.molNotifiedAt) : ''
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="molReportNumber"
                        label={regulatoryT('authorityReportNumber', {
                          abbreviation: regulatory.authorityAbbreviation,
                        })}
                        initialValue={incident.molReportNumber}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.policeNotified ? (
                    <SubBlock title={tGenerated('m_051ed4848b2b2f')} tone="indigo">
                      <LiveField
                        id={id}
                        field="policeReportNumber"
                        label={tGenerated('m_13f7c5b2973809')}
                        initialValue={incident.policeReportNumber}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="insuranceClaimNumber"
                        label={tGenerated('m_1db0cce6a15bdd')}
                        initialValue={incident.insuranceClaimNumber}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.lostTime ? (
                    <SubBlock title={tGenerated('m_0569d48a16120f')} tone="slate">
                      <LiveField
                        id={id}
                        field="lostTimeFirstDay"
                        label={tGenerated('m_1c40d052f5b2b3')}
                        type="date"
                        initialValue={incident.lostTimeFirstDay}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="lostTimeLastDay"
                        label={tGenerated('m_141b64436c5327')}
                        type="date"
                        initialValue={incident.lostTimeLastDay}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="lostTimeDays"
                        label={tGenerated('m_1fdff7e0b28365')}
                        type="number"
                        initialValue={
                          incident.lostTimeDays != null ? String(incident.lostTimeDays) : null
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  incident.modifiedDuty ? (
                    <SubBlock title={tGenerated('m_091d9af6dbc966')} tone="slate">
                      <LiveField
                        id={id}
                        field="modifiedDutyFirstDay"
                        label={tGenerated('m_15f5f067da4642')}
                        type="date"
                        initialValue={incident.modifiedDutyFirstDay}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="modifiedDutyLastDay"
                        label={tGenerated('m_089d5dcb2ef99f')}
                        type="date"
                        initialValue={incident.modifiedDutyLastDay}
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                      <LiveField
                        id={id}
                        field="modifiedDutyDays"
                        label={tGenerated('m_10cff3f8f31900')}
                        type="number"
                        initialValue={
                          incident.modifiedDutyDays != null
                            ? String(incident.modifiedDutyDays)
                            : null
                        }
                        disabled={locked}
                        updateAction={updateTextField}
                      />
                    </SubBlock>
                  ) : null
                }
              />

              <SubBlock title={tGenerated('m_0c26342a1f1de5')} tone="emerald">
                <LiveField
                  id={id}
                  field="damageEstimate"
                  label={tGenerated('m_131a237455e430')}
                  type="number"
                  initialValue={
                    incident.damageEstimate != null ? String(incident.damageEstimate) : null
                  }
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </SubBlock>
            </div>
          </Section>
        </section>

        {/* ===================== INJURIES ===================== */}
        <section id="section-injuries" className="scroll-mt-2">
          <Section
            title={tGenerated('m_1fac0fc3107966', { value0: injuries.length })}
            subtitle={tGenerated('m_02b4ce99c12709')}
            icon={<Activity size={20} />}
            tone="rose"
            actions={
              !locked ? (
                <Link href={drawerHref('add-injury') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> <GeneratedText id="m_141cf443767ce4" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                injuries.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_00e28e68a27147')}
                    description={tGenerated('m_157c8fc9c6b318')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={injuries.map((row) => (
                        <li
                          key={row.injury.id}
                          className="group grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedValue
                                value={
                                  row.person ? (
                                    <Link
                                      href={`/people/${row.person.id}`}
                                      className="hover:underline"
                                    >
                                      <GeneratedValue value={row.person.firstName} />{' '}
                                      <GeneratedValue value={row.person.lastName} />
                                    </Link>
                                  ) : (
                                    (row.injury.personName ?? '—')
                                  )
                                }
                              />
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedText id="m_0302a5e13ea3a7" />{' '}
                              <GeneratedValue value={row.injury.bodyParts.join(', ') || '—'} />
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedText id="m_02f291bf53e5ac" />
                              <GeneratedValue value={' '} />
                              <GeneratedValue
                                value={row.assignedTypes.map((type) => type.name).join(', ') || '—'}
                              />
                            </div>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                row.injury.injuryResult ? (
                                  <p>
                                    <span className="font-medium">
                                      <GeneratedText id="m_1a74936369b40e" />
                                    </span>
                                    <GeneratedValue value={' '} />
                                    <GeneratedValue value={row.injury.injuryResult} />
                                  </p>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                row.injury.treatment ? (
                                  <p>
                                    <span className="font-medium">
                                      <GeneratedText id="m_1ea19b8ca52c54" />
                                    </span>{' '}
                                    <GeneratedValue value={row.injury.treatment} />
                                  </p>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                row.injury.treatedAtFacility ? (
                                  <p className="text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_1d1f173920594c" />{' '}
                                    <GeneratedValue value={row.injury.treatedAtFacility} />
                                  </p>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                typeof row.injury.workedHoursPriorTo === 'number' ? (
                                  <p className="text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_0c0a0c730dce33" />{' '}
                                    <GeneratedValue value={row.injury.workedHoursPriorTo} />
                                  </p>
                                ) : null
                              }
                            />
                          </div>
                          <GeneratedValue
                            value={
                              !locked ? (
                                <div className="flex items-start gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                                  <Link
                                    href={
                                      drawerHref('edit-injury', { editId: row.injury.id }) as any
                                    }
                                    scroll={false}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                    title={tGenerated('m_011c199f991de6')}
                                    aria-label={tGenerated('m_011c199f991de6')}
                                  >
                                    <Pencil size={14} />
                                  </Link>
                                  <form action={deleteIncidentInjury} className="inline">
                                    <input type="hidden" name="id" value={row.injury.id} />
                                    <input type="hidden" name="incidentId" value={id} />
                                    <button
                                      type="submit"
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                      title={tGenerated('m_1b6d48e2d356e7')}
                                      aria-label={tGenerated('m_1b6d48e2d356e7')}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </form>
                                </div>
                              ) : null
                            }
                          />
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>
        </section>

        {/* ===================== KEY METRICS ===================== */}
        <section id="section-metrics" className="scroll-mt-2">
          <Section
            title={tGenerated('m_1f8afc53413180')}
            subtitle={tGenerated('m_1fb4b64e2c787a')}
            icon={<Gauge size={20} />}
            tone="amber"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <LiveSeverityRating
                id={id}
                field="actualSeverity"
                label={tGenerated('m_19cec370baaabb')}
                initialValue={incident.actualSeverity}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSeverityRating
                id={id}
                field="potentialSeverity"
                label={tGenerated('m_04e65f97982772')}
                initialValue={incident.potentialSeverity}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSeverityRating
                id={id}
                field="severityRating"
                label={tGenerated('m_06cdd9cd175160')}
                initialValue={incident.severityRating}
                disabled={locked}
                updateAction={updateTextField}
              />
            </div>
          </Section>
        </section>

        {/* ===================== LOST TIME ===================== */}
        <section id="section-lost-time" className="scroll-mt-2">
          <Section
            title={tGenerated('m_19b5f77f577fe5', { value0: lostTime.length })}
            subtitle={tGenerated('m_000bcc93ac6693')}
            icon={<Clock size={20} />}
            tone="blue"
            actions={
              !locked ? (
                <Link href={drawerHref('add-lost-time') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> <GeneratedText id="m_1eabd71bbc0199" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                lostTime.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_18e2d38da3feb0')}
                    description={tGenerated('m_1682e345c18062')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={lostTime.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              <GeneratedValue
                                value={
                                  e.status === 'off_work' ? (
                                    <Badge variant="destructive">
                                      <GeneratedText id="m_131a54d6d8ac12" />
                                    </Badge>
                                  ) : e.status === 'restricted_duty' ? (
                                    <Badge variant="warning">
                                      <GeneratedText id="m_1d484f3bf58cc5" />
                                    </Badge>
                                  ) : (
                                    <Badge variant="success">
                                      <GeneratedText id="m_1e22cd58b7a004" />
                                    </Badge>
                                  )
                                }
                              />
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-mono">
                                <GeneratedValue value={e.validFrom} />
                              </span>
                              <span> → </span>
                              <span className="font-mono">
                                <GeneratedValue
                                  value={e.validTo ?? <GeneratedText id="m_0d4c06f3af4f1f" />}
                                />
                              </span>
                              <GeneratedValue
                                value={
                                  e.notes ? (
                                    <span className="ml-2">
                                      · <GeneratedValue value={e.notes} />
                                    </span>
                                  ) : null
                                }
                              />
                            </div>
                          </div>
                          <GeneratedValue
                            value={
                              !locked ? (
                                <form action={deleteLostTimeEvent} className="inline">
                                  <input type="hidden" name="id" value={e.id} />
                                  <input type="hidden" name="incidentId" value={id} />
                                  <button
                                    type="submit"
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                    title={tGenerated('m_071f43c9483216')}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </form>
                              ) : null
                            }
                          />
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>
        </section>

        {/* ===================== INVESTIGATION ===================== */}
        <section id="section-investigation" className="scroll-mt-2 space-y-5">
          <Section
            title={tGenerated('m_13302fbd83eedb', { value0: timelineEvents.length })}
            subtitle={tGenerated('m_1e71d6cc0a2fb7')}
            icon={<ListChecks size={20} />}
            tone="teal"
            actions={
              !locked ? (
                <Link href={drawerHref('new-event') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> <GeneratedText id="m_09cd8e0f2553a4" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                timelineEvents.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_02bcdaf555a3aa')}
                    description={tGenerated('m_164ce9bac37c9c')}
                  />
                ) : (
                  <ol className="relative space-y-3 border-l border-slate-200 pl-5 text-sm dark:border-slate-700">
                    <GeneratedValue
                      value={timelineEvents.map((e) => (
                        <li key={e.id} className="group relative">
                          <span className="absolute top-1 -left-[26px] h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-500 shadow dark:border-slate-900" />
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue
                                  value={formatDateTime(
                                    new Date(e.occurredAt),
                                    ctx.timezone,
                                    ctx.locale,
                                  )}
                                />
                              </div>
                              <div className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={e.description} />
                              </div>
                            </div>
                            <GeneratedValue
                              value={
                                !locked ? (
                                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <Link
                                      href={drawerHref('edit-event', { editId: e.id }) as any}
                                      scroll={false}
                                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                      title={tGenerated('m_188bbec3041c24')}
                                    >
                                      <Pencil size={14} />
                                    </Link>
                                    <form action={deleteEvent} className="inline">
                                      <input type="hidden" name="id" value={e.id} />
                                      <input type="hidden" name="incidentId" value={id} />
                                      <button
                                        type="submit"
                                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                        title={tGenerated('m_02bca2ef9d0a9c')}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </form>
                                  </div>
                                ) : null
                              }
                            />
                          </div>
                        </li>
                      ))}
                    />
                  </ol>
                )
              }
            />
          </Section>

          <Section
            title={tGenerated('m_166b3b96a3a7b9', { value0: factors.length })}
            subtitle={tGenerated('m_0fff563a644153')}
            icon={<AlertTriangle size={20} />}
            tone="amber"
            actions={
              !locked ? (
                <Link href={drawerHref('new-factor') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> <GeneratedText id="m_04e475dcb7d6d7" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                factors.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_13d4bc46702ee8')}
                    description={tGenerated('m_1e94402d1ed117')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={factors.map((f) => (
                        <li
                          key={f.id}
                          className="group flex items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <Badge variant="outline" className="mb-1 tracking-wide uppercase">
                              <GeneratedValue value={f.category} />
                            </Badge>
                            <div className="whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                              <GeneratedValue value={f.description} />
                            </div>
                          </div>
                          <GeneratedValue
                            value={
                              !locked ? (
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                  <Link
                                    href={drawerHref('edit-factor', { editId: f.id }) as any}
                                    scroll={false}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                    title={tGenerated('m_0c55222658daf8')}
                                  >
                                    <Pencil size={14} />
                                  </Link>
                                  <form action={deleteFactor} className="inline">
                                    <input type="hidden" name="id" value={f.id} />
                                    <input type="hidden" name="incidentId" value={id} />
                                    <button
                                      type="submit"
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                      title={tGenerated('m_0b69395e85f40b')}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </form>
                                </div>
                              ) : null
                            }
                          />
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>

          <Section
            title={tGenerated('m_1d618ba267da6f')}
            subtitle={tGenerated('m_13e191dbfdde54', { value0: whys.length })}
            icon={<HelpCircle size={20} />}
            tone="purple"
            actions={
              !locked && whys.length < 5 ? (
                <Link href={drawerHref('new-why') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> <GeneratedText id="m_030d3f5756f85d" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <div className="space-y-5">
              <LiveRichText
                id={id}
                field="rootCause"
                label={tGenerated('m_144853fbc930b0')}
                initialValue={incident.rootCause}
                placeholder={tGenerated('m_00cb435f0a2d5a')}
                disabled={locked}
                updateAction={updateTextField}
              />
              <div>
                <div className="mb-2 text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_13cb7d7cf77012" />
                </div>
                <GeneratedValue
                  value={
                    whys.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_174321cd6b2464" />
                      </p>
                    ) : (
                      <ol className="space-y-2 text-sm">
                        <GeneratedValue
                          value={whys.map((w) => (
                            <li
                              key={w.id}
                              className="group flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="mr-2 inline-flex h-5 w-12 items-center justify-center rounded bg-teal-100 text-[10px] font-semibold tracking-wide text-teal-800 uppercase dark:bg-teal-950/50 dark:text-teal-300">
                                  <GeneratedText id="m_11ba5ccd975250" />
                                  <GeneratedValue value={w.ordinal} />
                                </span>
                                <span className="whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={w.whyText} />
                                </span>
                              </div>
                              <GeneratedValue
                                value={
                                  !locked ? (
                                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                      <Link
                                        href={drawerHref('edit-why', { editId: w.id }) as any}
                                        scroll={false}
                                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                        title={tGenerated('m_1f323608dad8aa')}
                                      >
                                        <Pencil size={14} />
                                      </Link>
                                      <form action={deleteWhy} className="inline">
                                        <input type="hidden" name="id" value={w.id} />
                                        <input type="hidden" name="incidentId" value={id} />
                                        <button
                                          type="submit"
                                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                          title={tGenerated('m_03c0ac8461f32f')}
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </form>
                                    </div>
                                  ) : null
                                }
                              />
                            </li>
                          ))}
                        />
                      </ol>
                    )
                  }
                />
              </div>
            </div>
          </Section>

          <Section
            title={tGenerated('m_14b49f9de00884', { value0: prevSteps.length })}
            subtitle={tGenerated('m_19b8b1b6aec9e3')}
            icon={<ListChecks size={20} />}
            tone="emerald"
            actions={
              !locked ? (
                <Link href={drawerHref('new-prev-step') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> <GeneratedText id="m_0ce705b8fa979c" />
                  </Button>
                </Link>
              ) : null
            }
          >
            <GeneratedValue
              value={
                prevSteps.length === 0 ? (
                  <EmptyState
                    title={tGenerated('m_0aae8523273f7e')}
                    description={tGenerated('m_11023c424d6b5a')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={prevSteps.map((row) => (
                        <li
                          key={row.step.id}
                          className="group flex items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <PrevStepStatusBadge status={row.step.status as PrevStepStatus} />
                              <GeneratedValue
                                value={
                                  row.step.targetDate ? (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedText id="m_0fed2a204aff5a" />{' '}
                                      <span className="font-mono">
                                        <GeneratedValue value={row.step.targetDate} />
                                      </span>
                                    </span>
                                  ) : null
                                }
                              />
                              <GeneratedValue
                                value={
                                  row.owner ? (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedText id="m_1dd6db678806d3" />
                                      <GeneratedValue value={' '} />
                                      <Link
                                        href={`/people/${row.owner.id}`}
                                        className="text-teal-700 hover:underline dark:text-teal-400"
                                      >
                                        <GeneratedValue value={row.owner.firstName} />{' '}
                                        <GeneratedValue value={row.owner.lastName} />
                                      </Link>
                                    </span>
                                  ) : null
                                }
                              />
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                              <GeneratedValue value={row.step.description} />
                            </div>
                          </div>
                          <GeneratedValue
                            value={
                              !locked ? (
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                  <Link
                                    href={
                                      drawerHref('edit-prev-step', { editId: row.step.id }) as any
                                    }
                                    scroll={false}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                    title={tGenerated('m_1ca665e2ce9353')}
                                  >
                                    <Pencil size={14} />
                                  </Link>
                                  <form action={deletePrevStep} className="inline">
                                    <input type="hidden" name="id" value={row.step.id} />
                                    <input type="hidden" name="incidentId" value={id} />
                                    <button
                                      type="submit"
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                      title={tGenerated('m_1fa3c60a0275d2')}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </form>
                                </div>
                              ) : null
                            }
                          />
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>

          <Section
            title={tGenerated('m_02241dba0c339e', { value0: linkedCAs.length })}
            icon={<ListChecks size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <GeneratedValue
              value={
                linkedCAs.length === 0 ? (
                  <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
                    <span>
                      <GeneratedText id="m_016e8ea73b729f" />
                    </span>
                    <Link
                      href={`/corrective-actions/new?sourceEntityType=incident&sourceEntityId=${id}`}
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      <GeneratedText id="m_1f4c52fb482da1" />
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <GeneratedValue
                      value={linkedCAs.map((ca) => (
                        <li key={ca.id} className="flex items-center justify-between py-2">
                          <Link
                            href={`/corrective-actions/${ca.id}`}
                            className="font-medium hover:underline"
                          >
                            <GeneratedValue value={ca.reference} /> ·{' '}
                            <GeneratedValue value={ca.title} />
                          </Link>
                          <Badge variant={ca.status === 'closed' ? 'success' : 'warning'}>
                            <GeneratedValue value={ca.status} />
                          </Badge>
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </Section>
        </section>

        {/* ===================== PHOTOS ===================== */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={tGenerated('m_11939da4a6a866', { value0: photos.length })}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <div className="space-y-3">
              <PhotoGallery
                photos={galleryPhotos}
                editable={!locked}
                onUpdate={updateIncidentPhotoAction}
                onRemove={removeIncidentPhotoAction}
                onReorder={reorderIncidentPhotosAction}
              />
              <GeneratedValue
                value={
                  !locked ? (
                    <PhotoUploaderSection
                      attachAction={async (ids) => {
                        'use server'
                        await attachPhotos(id, ids)
                      }}
                    />
                  ) : null
                }
              />
            </div>
          </Section>
        </section>

        {/* ===================== ACTIVITY ===================== */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={tGenerated('m_158532c8e94ad5', { value0: activity.length })}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          </Section>
        </section>
      </div>

      {/* ===================== DRAWERS ===================== */}

      {/* People + injuries */}
      <PersonDrawer
        open={drawer === 'add-person'}
        closeHref={`${basePath}#section-people`}
        incidentId={id}
        action={saveIncidentPerson}
        mode="create"
      />
      <PersonDrawer
        open={drawer === 'edit-person' && !!editPersonRow}
        closeHref={`${basePath}#section-people`}
        incidentId={id}
        action={saveIncidentPerson}
        mode="edit"
        defaults={
          editPersonRow
            ? {
                id: editPersonRow.link.id,
                personId: editPersonRow.link.personId,
                personNameText: editPersonRow.link.personNameText,
                role: editPersonRow.link.role,
              }
            : undefined
        }
      />
      <InjuryDrawer
        open={drawer === 'add-injury'}
        closeHref={`${basePath}#section-injuries`}
        incidentId={id}
        action={saveIncidentInjury}
        mode="create"
      />
      <InjuryDrawer
        open={drawer === 'edit-injury' && !!editInjuryRow}
        closeHref={`${basePath}#section-injuries`}
        incidentId={id}
        action={saveIncidentInjury}
        mode="edit"
        defaults={
          editInjuryRow
            ? {
                id: editInjuryRow.injury.id,
                personId: editInjuryRow.injury.personId,
                personName: editInjuryRow.injury.personName,
                assignedTypes: editInjuryRow.assignedTypes,
                injuryResult: editInjuryRow.injury.injuryResult,
                bodyParts: editInjuryRow.injury.bodyParts,
                treatment: editInjuryRow.injury.treatment,
                treatedAtFacility: editInjuryRow.injury.treatedAtFacility,
                workedHoursPriorTo: editInjuryRow.injury.workedHoursPriorTo,
              }
            : undefined
        }
      />

      {/* Investigation */}
      <EventDrawer
        open={drawer === 'new-event'}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveEventAction}
        mode="create"
      />
      <EventDrawer
        open={drawer === 'edit-event' && !!editingEvent}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveEventAction}
        mode="edit"
        defaults={
          editingEvent
            ? {
                id: editingEvent.id,
                occurredAt: toLocalDatetime(editingEvent.occurredAt),
                description: editingEvent.description,
              }
            : undefined
        }
      />
      <FactorDrawer
        open={drawer === 'new-factor'}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveFactorAction}
        mode="create"
      />
      <FactorDrawer
        open={drawer === 'edit-factor' && !!editingFactor}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveFactorAction}
        mode="edit"
        defaults={
          editingFactor
            ? {
                id: editingFactor.id,
                category: editingFactor.category as FactorCategory,
                description: editingFactor.description,
              }
            : undefined
        }
      />
      <WhyDrawer
        open={drawer === 'new-why' && whys.length < 5}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveWhyAction}
        mode="create"
        nextOrdinal={nextWhyOrdinal}
      />
      <WhyDrawer
        open={drawer === 'edit-why' && !!editingWhy}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={saveWhyAction}
        mode="edit"
        nextOrdinal={nextWhyOrdinal}
        defaults={
          editingWhy
            ? { id: editingWhy.id, ordinal: editingWhy.ordinal, whyText: editingWhy.whyText }
            : undefined
        }
      />
      <PrevStepDrawer
        open={drawer === 'new-prev-step'}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={savePrevStepAction}
        mode="create"
      />
      <PrevStepDrawer
        open={drawer === 'edit-prev-step' && !!editingPrev}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={savePrevStepAction}
        mode="edit"
        defaults={
          editingPrev
            ? {
                id: editingPrev.id,
                description: editingPrev.description,
                ownerPersonId: editingPrev.ownerPersonId,
                targetDate: editingPrev.targetDate,
                status: editingPrev.status as PrevStepStatus,
              }
            : undefined
        }
      />

      {/* Lost-time add */}
      <UrlDrawer
        open={drawer === 'add-lost-time'}
        closeHref={`${basePath}#section-lost-time`}
        title={tGenerated('m_0d246c6ac6b39a')}
        description={tGenerated('m_0ffa46d85b740d')}
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-lost-time`}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="inc-lost-time-form">
              <GeneratedText id="m_1eabd71bbc0199" />
            </Button>
          </>
        }
      >
        <LostTimeAddForm
          formId="inc-lost-time-form"
          addAction={async (fd) => {
            'use server'
            fd.set('incidentId', id)
            await addLostTimeEvent(fd)
          }}
          injuryOptions={injuries.map((row) => ({
            id: row.injury.id,
            label: row.person
              ? `${row.person.firstName} ${row.person.lastName}`
              : (row.injury.personName ?? 'Unknown'),
          }))}
        />
      </UrlDrawer>

      {/* Send email */}
      <UrlDrawer
        open={drawer === 'send-email'}
        closeHref={basePath}
        title={tGenerated('m_1c456341f763fe', { value0: incident.reference })}
        description={tGenerated('m_059320db1d18da')}
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="inc-send-email-form">
              <GeneratedText id="m_09dfca28fc95ba" />
            </Button>
          </>
        }
      >
        <form
          id="inc-send-email-form"
          action={async (fd) => {
            'use server'
            fd.set('id', id)
            await sendEmailAction(fd)
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="inc-se-subject">
              <GeneratedText id="m_155e869f893331" />
            </Label>
            <Input
              id="inc-se-subject"
              name="subjectPrefix"
              defaultValue="Update"
              placeholder={tGenerated('m_1a1fe99effa1f0')}
            />
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_179df8c6e86ca9" />
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-se-recipients">
              <GeneratedText id="m_0d99b2b56f8b5d" />
            </Label>
            <Input
              id="inc-se-recipients"
              name="recipients"
              type="text"
              required
              placeholder={tGenerated('m_01747fbecd701f')}
            />
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_0fb66d6a190ad4" />
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-se-message">
              <GeneratedText id="m_1edfd286d11988" />
            </Label>
            <Textarea
              id="inc-se-message"
              name="message"
              rows={4}
              placeholder={tGenerated('m_03ec1b3acac658')}
            />
          </div>
        </form>
      </UrlDrawer>

      {/* Copy */}
      <UrlDrawer
        open={drawer === 'copy'}
        closeHref={basePath}
        title={tGenerated('m_159dba59ad1469', { value0: incident.reference })}
        description={tGenerated('m_0e22871f172955')}
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <Button type="submit" form="inc-copy-form">
              <Copy size={14} /> <GeneratedText id="m_1f45061c87e9d8" />
            </Button>
          </>
        }
      >
        <form id="inc-copy-form" action={copyIncident} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor="inc-copy-title">
              <GeneratedText id="m_09418687fa6c5d" />
            </Label>
            <Input
              id="inc-copy-title"
              name="title"
              defaultValue={`Copy of ${incident.title}`}
              placeholder={tGenerated('m_060afde21bc0c2')}
            />
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_0fa1c32fc5f6fb" />
            </p>
          </div>
        </form>
      </UrlDrawer>

      {/* Delete confirmation */}
      <UrlDrawer
        open={drawer === 'confirm-delete'}
        closeHref={basePath}
        title={tGenerated('m_05088543b0ac2e')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
              <GeneratedValue value={incident.reference} />
            </span>
            <GeneratedValue value={' '} />
            <GeneratedText id="m_1a4a84621ce774" />
          </p>
          <div className="flex items-center justify-end gap-2">
            <Link href={basePath as any}>
              <Button type="button" variant="outline">
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            </Link>
            <form action={deleteIncident}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" className="bg-red-600 text-white hover:bg-red-700">
                <Trash2 size={14} /> <GeneratedText id="m_10534a969ce869" />
              </Button>
            </form>
          </div>
        </div>
      </UrlDrawer>
    </DetailPageLayout>
  )
}

// ---- presentational helpers ------------------------------------------------

function SubBlock({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'rose' | 'amber' | 'sky' | 'orange' | 'indigo' | 'emerald' | 'slate'
  children: React.ReactNode
}) {
  const TONE: Record<string, string> = {
    rose: 'border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20',
    amber: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20',
    sky: 'border-sky-200 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20',
    orange: 'border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/20',
    indigo: 'border-indigo-200 bg-indigo-50/40 dark:border-indigo-900/40 dark:bg-indigo-950/20',
    emerald:
      'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20',
    slate: 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/30',
  }
  return (
    <div className={`rounded-lg border p-3 ${TONE[tone]}`}>
      <div className="mb-2 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300">
        <GeneratedValue value={title} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GeneratedValue value={children} />
      </div>
    </div>
  )
}

function PrevStepStatusBadge({ status }: { status: PrevStepStatus }) {
  if (status === 'completed')
    return (
      <Badge variant="success">
        <GeneratedText id="m_0ba7a5e1b2fa32" />
      </Badge>
    )
  if (status === 'in_progress')
    return (
      <Badge variant="warning">
        <GeneratedText id="m_1a03b06872ffd9" />
      </Badge>
    )
  return (
    <Badge variant="outline">
      <GeneratedText id="m_0d841caeb35af0" />
    </Badge>
  )
}

// Convert a UTC Date into the local "YYYY-MM-DDTHH:MM" form that
// <input type="datetime-local"> expects.
function toLocalDatetime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function formatRel(d: Date | string, timeZone: string, locale: AppLocale): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const ms = Date.now() - date.getTime()
  const days = Math.round(ms / 86_400_000)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (days < 1) return relative.format(0, 'day')
  if (days < 2) return relative.format(-1, 'day')
  if (days < 30) return relative.format(-days, 'day')
  return formatDate(date, timeZone, locale)
}
