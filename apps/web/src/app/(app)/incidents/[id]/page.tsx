import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
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
import {
  attachments,
  correctiveActions,
  departments,
  incidentAttachments,
  incidentClassifications,
  incidentContributingFactors,
  incidentEvents,
  incidentInjuries,
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
import { pickString } from '@/lib/list-params'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { assertCan, can } from '@beaconhs/tenant'
import { canSeeRecord } from '@/lib/visibility'
import { canManageModule } from '@/lib/module-admin/guard'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
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
  LivePersonSelect,
  LiveRichText,
  LiveSelect,
  LiveSeverityRating,
  LiveToggle,
} from '@/components/live-field'
import { emitIncidentStatusChanged } from '@beaconhs/events'
import { emitIncidentStatusChanged as fireIncidentStatusIntegration } from '@beaconhs/integrations'
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
  const prior = await ctx.db(async (tx) => {
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
    return row ?? null
  })
  const fromStatus = prior?.status ?? null
  await ctx.db((tx) =>
    tx
      .update(incidents)
      .set({
        status: status as any,
        closedAt: closing ? new Date() : null,
        inProgress: !closing,
        locked: closing,
      })
      .where(eq(incidents.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: `Status changed to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
  if (fromStatus && fromStatus !== status) {
    await emitIncidentStatusChanged(ctx, { incidentId: id, fromStatus, toStatus: status })
    await runModuleFlows(ctx, {
      moduleKey: 'incidents',
      event: 'status_change',
      subjectId: id,
      toStatus: status,
    })
    await fireIncidentStatusIntegration(ctx, {
      id,
      reference: prior?.reference,
      title: prior?.title,
      type: prior?.type,
      severity: prior?.severity,
      fromStatus,
      toStatus: status,
    }).catch(() => {})
  }
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
  await ctx.db((tx) => tx.update(incidents).set({ locked: lock }).where(eq(incidents.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: lock ? 'Locked' : 'Unlocked',
    after: { locked: lock },
  })
  await runModuleFlows(ctx, {
    moduleKey: 'incidents',
    event: lock ? 'on_lock' : 'on_unlock',
    subjectId: id,
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
  await ctx.db((tx) =>
    tx.insert(incidentAttachments).values(
      attachmentIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        incidentId,
        attachmentId,
      })),
    ),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Attached ${attachmentIds.length} photo${attachmentIds.length === 1 ? '' : 's'}`,
  })
  revalidatePath(`/incidents/${incidentId}`)
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
  const extraRaw = String(formData.get('extraRecipients') ?? '').trim()
  const extraRecipients = extraRaw
    ? extraRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    : undefined
  await sendIncidentEmail(ctx, id, { subjectPrefix, messageOverride, extraRecipients })
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

  const year = new Date().getFullYear()
  const [{ c } = { c: 0 }] = await ctx.db((tx) =>
    tx
      .select({ c: count() })
      .from(incidents)
      .where(sql`extract(year from ${incidents.occurredAt}) = ${year}`),
  )
  const reference = `INC-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`

  const [row] = await ctx.db((tx) =>
    tx
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
      .returning(),
  )
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

async function saveIncidentInjury(input: InjuryInput): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  if (!input.incidentId) return { ok: false, error: 'Missing incident.' }
  if (!input.personId && !input.personName)
    return { ok: false, error: 'Pick the injured person or type a name.' }
  await assertCanSeeIncident(ctx, input.incidentId)
  const values = {
    personId: input.personId,
    personName: input.personName,
    injuryTypeId: input.injuryTypeId,
    injuryTypes: input.injuryTypes,
    bodyParts: input.bodyParts,
    treatment: input.treatment,
    treatedAtFacility: input.treatedAtFacility,
    workedHoursPriorTo: input.workedHoursPriorTo,
  }
  if (input.id) {
    await ctx.db((tx) =>
      tx.update(incidentInjuries).set(values).where(eq(incidentInjuries.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: 'Edited injury',
    })
  } else {
    await ctx.db((tx) =>
      tx.insert(incidentInjuries).values({
        tenantId: ctx.tenantId,
        incidentId: input.incidentId,
        ...values,
      }),
    )
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: input.incidentId,
      action: 'update',
      summary: 'Added injury',
    })
  }
  revalidatePath(`/incidents/${input.incidentId}`)
  return { ok: true }
}

async function deleteIncidentInjury(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.update')
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  await assertCanSeeIncident(ctx, incidentId)
  await ctx.db((tx) => tx.delete(incidentInjuries).where(eq(incidentInjuries.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: 'Removed injury',
  })
  revalidatePath(`/incidents/${incidentId}`)
}

// ---- Lost-time events ------------------------------------------------------

async function addLostTimeEvent(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const incidentId = String(formData.get('incidentId') ?? '')
  const status = String(formData.get('status') ?? '') as
    | 'off_work'
    | 'restricted_duty'
    | 'full_duty'
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
  const { id } = await params
  return { title: `Incident · ${id.slice(0, 8)}` }
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.editId)
  const ctx = await requireRequestContext()
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

    // Options for the inline live selects + drawers.
    const siteOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const departmentOptions = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
    const classificationOptions = await tx
      .select({ id: incidentClassifications.id, name: incidentClassifications.name })
      .from(incidentClassifications)
      .where(
        and(isNull(incidentClassifications.deletedAt), eq(incidentClassifications.isActive, 1)),
      )
      .orderBy(asc(incidentClassifications.name))
    const injuryTypeOptions = await tx
      .select({ id: incidentInjuryTypes.id, name: incidentInjuryTypes.name })
      .from(incidentInjuryTypes)
      .where(and(isNull(incidentInjuryTypes.deletedAt), eq(incidentInjuryTypes.isActive, 1)))
      .orderBy(asc(incidentInjuryTypes.sortOrder), asc(incidentInjuryTypes.name))
    const peopleList = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)

    return {
      ...row,
      injuries,
      lostTime,
      involved,
      linkedCAs,
      photos,
      timelineEvents,
      factors,
      whys,
      prevSteps,
      siteOptions,
      departmentOptions,
      classificationOptions,
      injuryTypeOptions,
      peopleList,
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
    siteOptions,
    departmentOptions,
    classificationOptions,
    injuryTypeOptions,
    peopleList,
  } = data

  const canManage = canManageModule(ctx, 'incidents')
  const locked = incident.locked
  const activity = await recentActivityForEntity(ctx, 'incident', id, 25)

  // Smallest unused ordinal (1..5) for adding a new "why" row.
  const usedOrdinals = new Set(whys.map((w) => w.ordinal))
  const nextWhyOrdinal = [1, 2, 3, 4, 5].find((n) => !usedOrdinals.has(n)) ?? 5

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const personOpts = peopleList.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName}`,
    hint: [p.firstName, p.lastName].filter(Boolean).join(' '),
  }))

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
          title={incident.title}
          subtitle={`${incident.reference} · reported ${formatRel(incident.reportedAt)}`}
          badge={
            <div className="flex items-center gap-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              {locked ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
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
          {locked ? (
            <Alert variant="warning">
              <AlertTitle>This incident is locked</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Closed on{' '}
                  {incident.closedAt ? new Date(incident.closedAt).toLocaleDateString() : '—'}.
                  Unlock to make edits.
                </span>
                <form action={toggleLock} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="lock" value="false" />
                  <Button variant="outline" size="sm" type="submit">
                    <Unlock size={12} /> Unlock
                  </Button>
                </form>
              </AlertDescription>
            </Alert>
          ) : null}
          {incident.criticalInjury || incident.ministryOfLabourNotified ? (
            <Alert variant="destructive">
              <AlertTriangle size={16} />
              <AlertTitle>Critical incident</AlertTitle>
              <AlertDescription>
                {incident.criticalInjury ? 'Flagged as a critical injury. ' : ''}
                {incident.ministryOfLabourNotified ? 'Ministry of Labour was notified.' : ''}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="space-y-5">
        {pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}
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
                  {pct}%
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {doneCount} of {milestones.length} steps complete
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  {incident.type.replace(/_/g, ' ')}
                  {site ? ` · ${site.name}` : ''}
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
            title="General Information"
            subtitle="Who, what, where, when"
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <LiveSelect
                id={id}
                field="type"
                label="Type"
                initialValue={incident.type}
                allowEmpty={false}
                options={TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="severity"
                label="Severity"
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
                  label="Title"
                  initialValue={incident.title}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveDateTime
                id={id}
                field="occurredAt"
                label="Occurred at"
                initialValue={toLocalDatetime(incident.occurredAt)}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="siteOrgUnitId"
                label="Site"
                initialValue={incident.siteOrgUnitId}
                options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="departmentId"
                label="Department"
                initialValue={incident.departmentId}
                options={departmentOptions.map((d) => ({ value: d.id, label: d.name }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSelect
                id={id}
                field="classificationId"
                label="Classification"
                initialValue={incident.classificationId}
                options={classificationOptions.map((c) => ({ value: c.id, label: c.name }))}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="location"
                label="Location on site"
                initialValue={incident.location}
                placeholder="Building / area / equipment"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="weather"
                label="Weather"
                initialValue={incident.weather}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LivePersonSelect
                id={id}
                field="supervisorPersonId"
                label="Supervisor"
                initialValue={incident.supervisorPersonId}
                options={personOpts}
                sheetTitle="Select supervisor"
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveField
                id={id}
                field="foremanText"
                label="Foreman"
                initialValue={incident.foremanText}
                disabled={locked}
                updateAction={updateTextField}
              />
            </div>
          </Section>

          <Section
            title="Narrative"
            subtitle="The story of what happened"
            icon={<FileText size={20} />}
            tone="slate"
          >
            <div className="space-y-4">
              <LiveRichText
                id={id}
                field="eventsLeadingUp"
                label="Events leading up to the incident"
                initialValue={incident.eventsLeadingUp}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="description"
                label="Event details / cause"
                initialValue={incident.description}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveRichText
                id={id}
                field="immediateActionTaken"
                label="Immediate action taken"
                initialValue={incident.immediateActionTaken}
                disabled={locked}
                updateAction={updateTextField}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LiveRichText
                  id={id}
                  field="witnesses"
                  label="Witnesses"
                  initialValue={incident.witnesses}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveRichText
                  id={id}
                  field="externalPeopleInvolved"
                  label="External people involved"
                  initialValue={incident.externalPeopleInvolved}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>
              <LiveField
                id={id}
                field="ppeWorn"
                label="PPE worn"
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
            title={`People involved (${involved.length})`}
            subtitle="Employees and external parties tied to this incident"
            icon={<Users size={20} />}
            tone="teal"
            actions={
              !locked ? (
                <Link href={drawerHref('add-person') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> Add person
                  </Button>
                </Link>
              ) : null
            }
          >
            {involved.length === 0 ? (
              <EmptyState
                title="No people recorded"
                description="Add the employees, witnesses, or external parties involved."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {involved.map((row) => (
                  <li
                    key={row.link.id}
                    className="group flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.person ? (
                          <Link href={`/people/${row.person.id}`} className="hover:underline">
                            {row.person.firstName} {row.person.lastName}
                          </Link>
                        ) : (
                          (row.link.personNameText ?? '—')
                        )}
                      </div>
                      {row.link.role ? (
                        <Badge variant="outline" className="mt-1 capitalize">
                          {row.link.role}
                        </Badge>
                      ) : null}
                    </div>
                    {!locked ? (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={drawerHref('edit-person', { editId: row.link.id }) as any}
                          scroll={false}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                          title="Edit person"
                        >
                          <Pencil size={14} />
                        </Link>
                        <form action={deleteIncidentPerson} className="inline">
                          <input type="hidden" name="id" value={row.link.id} />
                          <input type="hidden" name="incidentId" value={id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Remove person"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </section>

        {/* ===================== MEDICAL ===================== */}
        <section id="section-medical" className="scroll-mt-2">
          <Section
            title="Medical"
            subtitle="EMS, first aid, hospital, notifications, lost time"
            icon={<HeartPulse size={20} />}
            tone="rose"
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <LiveToggle
                  id={id}
                  field="criticalInjury"
                  label="Critical injury"
                  initialValue={incident.criticalInjury}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="ministryOfLabourNotified"
                  label="Ministry of Labour notified"
                  initialValue={incident.ministryOfLabourNotified}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="emsCalled"
                  label="EMS called"
                  initialValue={incident.emsCalled || incident.emsNotified}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="firstAidGiven"
                  label="First aid given"
                  initialValue={incident.firstAidGiven || incident.firstAidReceived}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="medicalAttentionReceived"
                  label="Medical attention"
                  initialValue={incident.medicalAttentionReceived}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="lostTime"
                  label="Lost time"
                  initialValue={incident.lostTime}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="modifiedDuty"
                  label="Modified duty"
                  initialValue={incident.modifiedDuty}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="externallyReportable"
                  label="Externally reportable"
                  initialValue={incident.externallyReportable}
                  disabled={locked}
                  updateAction={updateTextField}
                />
                <LiveToggle
                  id={id}
                  field="policeNotified"
                  label="Police notified"
                  initialValue={incident.policeNotified}
                  disabled={locked}
                  updateAction={updateTextField}
                />
              </div>

              {incident.emsCalled || incident.emsNotified ? (
                <SubBlock title="EMS" tone="rose">
                  <LiveDateTime
                    id={id}
                    field="emsArrivedAt"
                    label="EMS arrived at"
                    initialValue={
                      incident.emsArrivedAt ? toLocalDatetime(incident.emsArrivedAt) : ''
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.firstAidGiven || incident.firstAidReceived ? (
                <SubBlock title="First aid" tone="amber">
                  <LiveField
                    id={id}
                    field="firstAidProvider"
                    label="First aid provider"
                    initialValue={incident.firstAidProvider}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="firstAidNotes"
                    label="First aid notes"
                    initialValue={incident.firstAidNotes}
                    multiline
                    rows={2}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.medicalAttentionReceived ? (
                <SubBlock title="Hospital / treatment" tone="sky">
                  <LiveField
                    id={id}
                    field="hospitalName"
                    label="Hospital"
                    initialValue={incident.hospitalName ?? incident.treatedAtHospital}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="treatedInCity"
                    label="City"
                    initialValue={incident.treatedInCity}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="transportation"
                    label="Transportation"
                    initialValue={incident.transportation}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="attendingPhysician"
                    label="Attending physician"
                    initialValue={incident.attendingPhysician}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveDateTime
                    id={id}
                    field="hospitalArrivedAt"
                    label="Hospital arrived"
                    initialValue={
                      incident.hospitalArrivedAt ? toLocalDatetime(incident.hospitalArrivedAt) : ''
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveDateTime
                    id={id}
                    field="dischargedAt"
                    label="Discharged"
                    initialValue={
                      incident.dischargedAt ? toLocalDatetime(incident.dischargedAt) : ''
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.ministryOfLabourNotified ? (
                <SubBlock title="Ministry of Labour" tone="orange">
                  <LiveDateTime
                    id={id}
                    field="molNotifiedAt"
                    label="MOL notified at"
                    initialValue={
                      incident.molNotifiedAt ? toLocalDatetime(incident.molNotifiedAt) : ''
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="molReportNumber"
                    label="MOL report number"
                    initialValue={incident.molReportNumber}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.policeNotified ? (
                <SubBlock title="Police / insurance" tone="indigo">
                  <LiveField
                    id={id}
                    field="policeReportNumber"
                    label="Police report #"
                    initialValue={incident.policeReportNumber}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="insuranceClaimNumber"
                    label="Insurance claim #"
                    initialValue={incident.insuranceClaimNumber}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.lostTime ? (
                <SubBlock title="Lost-time summary" tone="slate">
                  <LiveField
                    id={id}
                    field="lostTimeFirstDay"
                    label="First day off"
                    type="date"
                    initialValue={incident.lostTimeFirstDay}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="lostTimeLastDay"
                    label="Last day off"
                    type="date"
                    initialValue={incident.lostTimeLastDay}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="lostTimeDays"
                    label="Total lost-time days"
                    type="number"
                    initialValue={
                      incident.lostTimeDays != null ? String(incident.lostTimeDays) : null
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              {incident.modifiedDuty ? (
                <SubBlock title="Modified-duty summary" tone="slate">
                  <LiveField
                    id={id}
                    field="modifiedDutyFirstDay"
                    label="First modified day"
                    type="date"
                    initialValue={incident.modifiedDutyFirstDay}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="modifiedDutyLastDay"
                    label="Last modified day"
                    type="date"
                    initialValue={incident.modifiedDutyLastDay}
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                  <LiveField
                    id={id}
                    field="modifiedDutyDays"
                    label="Total modified-duty days"
                    type="number"
                    initialValue={
                      incident.modifiedDutyDays != null ? String(incident.modifiedDutyDays) : null
                    }
                    disabled={locked}
                    updateAction={updateTextField}
                  />
                </SubBlock>
              ) : null}

              <SubBlock title="Damage & cost" tone="emerald">
                <LiveField
                  id={id}
                  field="damageEstimate"
                  label="Damage estimate (USD)"
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
            title={`Injuries (${injuries.length})`}
            subtitle="Per-person injury detail"
            icon={<Activity size={20} />}
            tone="rose"
            actions={
              !locked ? (
                <Link href={drawerHref('add-injury') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> Add injury
                  </Button>
                </Link>
              ) : null
            }
          >
            {injuries.length === 0 ? (
              <EmptyState
                title="No injuries recorded"
                description="Add an injured person and their injuries."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {injuries.map((row) => (
                  <li
                    key={row.injury.id}
                    className="group grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.person ? (
                          <Link href={`/people/${row.person.id}`} className="hover:underline">
                            {row.person.firstName} {row.person.lastName}
                          </Link>
                        ) : (
                          (row.injury.personName ?? '—')
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Body part(s): {row.injury.bodyParts.join(', ') || '—'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Injury type(s): {row.injury.injuryTypes.join(', ') || '—'}
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {row.injury.treatment ? <p>{row.injury.treatment}</p> : null}
                      {row.injury.treatedAtFacility ? (
                        <p className="text-slate-500 dark:text-slate-400">
                          Treated at: {row.injury.treatedAtFacility}
                        </p>
                      ) : null}
                      {typeof row.injury.workedHoursPriorTo === 'number' ? (
                        <p className="text-slate-500 dark:text-slate-400">
                          Hours worked prior: {row.injury.workedHoursPriorTo}
                        </p>
                      ) : null}
                    </div>
                    {!locked ? (
                      <div className="flex items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={drawerHref('edit-injury', { editId: row.injury.id }) as any}
                          scroll={false}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                          title="Edit injury"
                        >
                          <Pencil size={14} />
                        </Link>
                        <form action={deleteIncidentInjury} className="inline">
                          <input type="hidden" name="id" value={row.injury.id} />
                          <input type="hidden" name="incidentId" value={id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Remove injury"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </section>

        {/* ===================== KEY METRICS ===================== */}
        <section id="section-metrics" className="scroll-mt-2">
          <Section
            title="Key metrics"
            subtitle="Actual vs potential severity (1–5)"
            icon={<Gauge size={20} />}
            tone="amber"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <LiveSeverityRating
                id={id}
                field="actualSeverity"
                label="Actual severity"
                initialValue={incident.actualSeverity}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSeverityRating
                id={id}
                field="potentialSeverity"
                label="Potential severity"
                initialValue={incident.potentialSeverity}
                disabled={locked}
                updateAction={updateTextField}
              />
              <LiveSeverityRating
                id={id}
                field="severityRating"
                label="Severity rating"
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
            title={`Lost-time + modified-duty events (${lostTime.length})`}
            subtitle="Off-work / restricted / full-duty transitions with date windows. Drives the DART rate."
            icon={<Clock size={20} />}
            tone="blue"
            actions={
              !locked ? (
                <Link href={drawerHref('add-lost-time') as any} scroll={false}>
                  <Button type="button" size="sm">
                    <Plus size={14} /> Add row
                  </Button>
                </Link>
              ) : null
            }
          >
            {lostTime.length === 0 ? (
              <EmptyState
                title="No lost-time tracking"
                description="Record an off-work or restricted-duty window."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {lostTime.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {e.status === 'off_work' ? (
                          <Badge variant="destructive">Off work</Badge>
                        ) : e.status === 'restricted_duty' ? (
                          <Badge variant="warning">Restricted duty</Badge>
                        ) : (
                          <Badge variant="success">Full duty</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{e.validFrom}</span>
                        <span> → </span>
                        <span className="font-mono">{e.validTo ?? 'present'}</span>
                        {e.notes ? <span className="ml-2">· {e.notes}</span> : null}
                      </div>
                    </div>
                    {!locked ? (
                      <form action={deleteLostTimeEvent} className="inline">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="incidentId" value={id} />
                        <button
                          type="submit"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          title="Delete row"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </section>

        {/* ===================== INVESTIGATION ===================== */}
        <section id="section-investigation" className="scroll-mt-2 space-y-5">
          <Section
            title={`Event timeline (${timelineEvents.length})`}
            subtitle="Chronological log of what happened, in order."
            icon={<ListChecks size={20} />}
            tone="teal"
            actions={
              !locked ? (
                <Link href={drawerHref('new-event') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> Add event
                  </Button>
                </Link>
              ) : null
            }
          >
            {timelineEvents.length === 0 ? (
              <EmptyState
                title="No events logged"
                description="Add a timeline entry to reconstruct the sequence."
              />
            ) : (
              <ol className="relative space-y-3 border-l border-slate-200 pl-5 text-sm dark:border-slate-700">
                {timelineEvents.map((e) => (
                  <li key={e.id} className="group relative">
                    <span className="absolute top-1 -left-[26px] h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-500 shadow dark:border-slate-900" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {new Date(e.occurredAt).toLocaleString()}
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                          {e.description}
                        </div>
                      </div>
                      {!locked ? (
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Link
                            href={drawerHref('edit-event', { editId: e.id }) as any}
                            scroll={false}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                            title="Edit event"
                          >
                            <Pencil size={14} />
                          </Link>
                          <form action={deleteEvent} className="inline">
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="incidentId" value={id} />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                              title="Delete event"
                            >
                              <Trash2 size={14} />
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            title={`Cause analysis (${factors.length})`}
            subtitle="Immediate causes / contributing factors, by category."
            icon={<AlertTriangle size={20} />}
            tone="amber"
            actions={
              !locked ? (
                <Link href={drawerHref('new-factor') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> Add factor
                  </Button>
                </Link>
              ) : null
            }
          >
            {factors.length === 0 ? (
              <EmptyState
                title="No contributing factors"
                description="Capture the conditions, behaviours, or system gaps."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {factors.map((f) => (
                  <li key={f.id} className="group flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Badge variant="outline" className="mb-1 tracking-wide uppercase">
                        {f.category}
                      </Badge>
                      <div className="whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                        {f.description}
                      </div>
                    </div>
                    {!locked ? (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={drawerHref('edit-factor', { editId: f.id }) as any}
                          scroll={false}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                          title="Edit factor"
                        >
                          <Pencil size={14} />
                        </Link>
                        <form action={deleteFactor} className="inline">
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="incidentId" value={id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Delete factor"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Root cause analysis"
            subtitle={`Free-form root cause plus an optional 5-whys chain (${whys.length}/5).`}
            icon={<HelpCircle size={20} />}
            tone="purple"
            actions={
              !locked && whys.length < 5 ? (
                <Link href={drawerHref('new-why') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> Add "why"
                  </Button>
                </Link>
              ) : null
            }
          >
            <div className="space-y-5">
              <LiveRichText
                id={id}
                field="rootCause"
                label="Root cause statement"
                initialValue={incident.rootCause}
                placeholder="One- or two-sentence summary of why this happened."
                disabled={locked}
                updateAction={updateTextField}
              />
              <div>
                <div className="mb-2 text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  5-Whys chain
                </div>
                {whys.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Optional. Drill from the surface cause toward the root by asking "why" up to
                    five times.
                  </p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {whys.map((w) => (
                      <li
                        key={w.id}
                        className="group flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="mr-2 inline-flex h-5 w-12 items-center justify-center rounded bg-teal-100 text-[10px] font-semibold tracking-wide text-teal-800 uppercase dark:bg-teal-950/50 dark:text-teal-300">
                            Why #{w.ordinal}
                          </span>
                          <span className="whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                            {w.whyText}
                          </span>
                        </div>
                        {!locked ? (
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Link
                              href={drawerHref('edit-why', { editId: w.id }) as any}
                              scroll={false}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                              title="Edit why step"
                            >
                              <Pencil size={14} />
                            </Link>
                            <form action={deleteWhy} className="inline">
                              <input type="hidden" name="id" value={w.id} />
                              <input type="hidden" name="incidentId" value={id} />
                              <button
                                type="submit"
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                title="Delete why step"
                              >
                                <Trash2 size={14} />
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Section>

          <Section
            title={`Preventative steps (${prevSteps.length})`}
            subtitle="What will be done so this doesn't happen again."
            icon={<ListChecks size={20} />}
            tone="emerald"
            actions={
              !locked ? (
                <Link href={drawerHref('new-prev-step') as any} scroll={false}>
                  <Button size="sm" variant="outline">
                    <Plus size={14} /> Add step
                  </Button>
                </Link>
              ) : null
            }
          >
            {prevSteps.length === 0 ? (
              <EmptyState
                title="No preventative steps"
                description="Record the changes that will prevent recurrence."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {prevSteps.map((row) => (
                  <li
                    key={row.step.id}
                    className="group flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <PrevStepStatusBadge status={row.step.status as PrevStepStatus} />
                        {row.step.targetDate ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            due <span className="font-mono">{row.step.targetDate}</span>
                          </span>
                        ) : null}
                        {row.owner ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            owner:{' '}
                            <Link
                              href={`/people/${row.owner.id}`}
                              className="text-teal-700 hover:underline dark:text-teal-400"
                            >
                              {row.owner.firstName} {row.owner.lastName}
                            </Link>
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                        {row.step.description}
                      </div>
                    </div>
                    {!locked ? (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={drawerHref('edit-prev-step', { editId: row.step.id }) as any}
                          scroll={false}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                          title="Edit step"
                        >
                          <Pencil size={14} />
                        </Link>
                        <form action={deletePrevStep} className="inline">
                          <input type="hidden" name="id" value={row.step.id} />
                          <input type="hidden" name="incidentId" value={id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            title="Delete step"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Linked corrective actions (${linkedCAs.length})`}
            icon={<ListChecks size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            {linkedCAs.length === 0 ? (
              <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
                <span>No corrective actions linked.</span>
                <Link
                  href={`/corrective-actions/new?sourceEntityType=incident&sourceEntityId=${id}`}
                  className="text-teal-700 hover:underline dark:text-teal-400"
                >
                  Create one →
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {linkedCAs.map((ca) => (
                  <li key={ca.id} className="flex items-center justify-between py-2">
                    <Link
                      href={`/corrective-actions/${ca.id}`}
                      className="font-medium hover:underline"
                    >
                      {ca.reference} · {ca.title}
                    </Link>
                    <Badge variant={ca.status === 'closed' ? 'success' : 'warning'}>
                      {ca.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </section>

        {/* ===================== PHOTOS ===================== */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={`Photos & files (${photos.length})`}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {!locked ? (
                <PhotoUploaderSection
                  attachAction={async (ids) => {
                    'use server'
                    await attachPhotos(id, ids)
                  }}
                />
              ) : null}
            </div>
          </Section>
        </section>

        {/* ===================== ACTIVITY ===================== */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={`Activity (${activity.length})`}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <ActivityFeed entries={activity} />
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
        people={peopleList}
      />
      <PersonDrawer
        open={drawer === 'edit-person' && !!editPersonRow}
        closeHref={`${basePath}#section-people`}
        incidentId={id}
        action={saveIncidentPerson}
        mode="edit"
        people={peopleList}
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
        people={peopleList}
        injuryTypeOptions={injuryTypeOptions}
      />
      <InjuryDrawer
        open={drawer === 'edit-injury' && !!editInjuryRow}
        closeHref={`${basePath}#section-injuries`}
        incidentId={id}
        action={saveIncidentInjury}
        mode="edit"
        people={peopleList}
        injuryTypeOptions={injuryTypeOptions}
        defaults={
          editInjuryRow
            ? {
                id: editInjuryRow.injury.id,
                personId: editInjuryRow.injury.personId,
                personName: editInjuryRow.injury.personName,
                injuryTypeId: editInjuryRow.injury.injuryTypeId,
                injuryTypes: editInjuryRow.injury.injuryTypes,
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
        people={peopleList}
      />
      <PrevStepDrawer
        open={drawer === 'edit-prev-step' && !!editingPrev}
        closeHref={`${basePath}#section-investigation`}
        incidentId={id}
        action={savePrevStepAction}
        mode="edit"
        people={peopleList}
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
        title="Add lost-time / modified-duty row"
        description="Record an off-work, restricted-duty, or full-duty transition with explicit date window."
        size="md"
        footer={
          <>
            <Link href={`${basePath}#section-lost-time`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="inc-lost-time-form">
              Add row
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
        title={`Send incident email · ${incident.reference}`}
        description="Sends a structured incident summary email to every active tenant admin. Add extra comma-separated email addresses below to copy specific recipients."
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="inc-send-email-form">
              Send email
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
            <Label htmlFor="inc-se-subject">Subject prefix</Label>
            <Input
              id="inc-se-subject"
              name="subjectPrefix"
              defaultValue="Update"
              placeholder="Update / Action required / FYI"
            />
            <p className="text-xs text-slate-500">Prepended to the auto-generated subject.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-se-extra">Extra recipients</Label>
            <Input
              id="inc-se-extra"
              name="extraRecipients"
              type="text"
              placeholder="ceo@example.com, hse@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-se-message">Personal note (optional)</Label>
            <Textarea
              id="inc-se-message"
              name="message"
              rows={4}
              placeholder="Add context for the recipients."
            />
          </div>
        </form>
      </UrlDrawer>

      {/* Copy */}
      <UrlDrawer
        open={drawer === 'copy'}
        closeHref={basePath}
        title={`Copy incident · ${incident.reference}`}
        description="Create a new incident pre-populated from this one. The copy starts in 'reported' status with a fresh reference and reset timestamps."
        size="md"
        footer={
          <>
            <Link href={basePath}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" form="inc-copy-form">
              <Copy size={14} /> Create copy
            </Button>
          </>
        }
      >
        <form id="inc-copy-form" action={copyIncident} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor="inc-copy-title">Title for the new incident</Label>
            <Input
              id="inc-copy-title"
              name="title"
              defaultValue={`Copy of ${incident.title}`}
              placeholder="Title for the cloned incident"
            />
            <p className="text-xs text-slate-500">
              Leave the default ("Copy of …") or override with a more descriptive title.
            </p>
          </div>
        </form>
      </UrlDrawer>

      {/* Delete confirmation */}
      <UrlDrawer
        open={drawer === 'confirm-delete'}
        closeHref={basePath}
        title="Delete this incident?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
              {incident.reference}
            </span>{' '}
            will be removed from every list and report. This is a soft delete — an administrator can
            recover it from the database if needed.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Link href={basePath as any}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <form action={deleteIncident}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" className="bg-red-600 text-white hover:bg-red-700">
                <Trash2 size={14} /> Delete incident
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
        {title}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function PrevStepStatusBadge({ status }: { status: PrevStepStatus }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'in_progress') return <Badge variant="warning">In progress</Badge>
  return <Badge variant="outline">Planned</Badge>
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

function formatRel(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const ms = Date.now() - date.getTime()
  const days = Math.round(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return date.toLocaleDateString()
}
