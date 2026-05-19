import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { AlertTriangle, Copy, FileText, Lock, Mail, Trash2, Unlock } from 'lucide-react'
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
  Select,
} from '@beaconhs/ui'
import {
  attachments,
  correctiveActions,
  departments,
  incidentAttachments,
  incidentInjuries,
  incidentLostTimeEvents,
  incidentPeople,
  incidents,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { sendIncidentEmail } from './_send-email'
import { SendEmailDialog } from './_send-email-dialog'
import { LostTimeAddForm } from './_lost-time-form'
import { pickString } from '@/lib/list-params'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { CheckIndicator } from '@/components/checkbox-field'
import { SeverityRating } from '@/components/severity-rating'
import { ActivityFeed } from '@/components/activity-feed'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import { emitIncidentStatusChanged } from '@beaconhs/events'
import { SeverityBadge, StatusBadge } from '../_badges'

export const dynamic = 'force-dynamic'

const STATUSES = ['reported', 'under_investigation', 'pending_review', 'closed', 'reopened'] as const

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return
  const closing = status === 'closed'
  const fromStatus = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ status: incidents.status })
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1)
    return row?.status ?? null
  })
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
  }
  revalidatePath(`/incidents/${id}`)
  revalidatePath('/incidents')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  await ctx.db((tx) => tx.update(incidents).set({ locked: lock }).where(eq(incidents.id, id)))
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: lock ? 'Locked' : 'Unlocked',
    after: { locked: lock },
  })
  revalidatePath(`/incidents/${id}`)
}

async function attachPhotos(incidentId: string, attachmentIds: string[]) {
  'use server'
  const ctx = await requireRequestContext()
  if (attachmentIds.length === 0) return
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
  const id = String(formData.get('id') ?? '')
  if (!id) return
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
  const sourceId = String(formData.get('id') ?? '')
  if (!sourceId) return
  const src = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, sourceId)).limit(1)
    return row ?? null
  })
  if (!src) return

  // Build a deterministic new reference: same year prefix, next sequence.
  const year = new Date().getFullYear()
  const [{ c }] = await ctx.db((tx) =>
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
        title: `Copy of ${src.title}`,
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
}

async function deleteLostTimeEvent(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const incidentId = String(formData.get('incidentId') ?? '')
  if (!id || !incidentId) return
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentLostTimeEvents)
      .where(eq(incidentLostTimeEvents.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return
  await ctx.db((tx) =>
    tx.delete(incidentLostTimeEvents).where(eq(incidentLostTimeEvents.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'update',
    summary: `Removed lost-time row (${before.status.replace(/_/g, ' ')}, from ${before.validFrom})`,
  })
  revalidatePath(`/incidents/${incidentId}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Incident · ${id.slice(0, 8)}` }
}

const INCIDENT_TABS = [
  'overview',
  'medical',
  'injuries',
  'lost-time',
  'investigation',
  'photos',
  'activity',
] as const
type IncidentTab = (typeof INCIDENT_TABS)[number]

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: IncidentTab = pickActiveTab(sp, INCIDENT_TABS, 'overview')
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        incident: incidents,
        site: orgUnits,
        department: departments,
        supervisor: people,
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .leftJoin(departments, eq(departments.id, incidents.departmentId))
      .leftJoin(people, eq(people.id, incidents.supervisorPersonId))
      .where(eq(incidents.id, id))
      .limit(1)
    if (!row) return null
    const injuries = await tx
      .select({ injury: incidentInjuries, person: people })
      .from(incidentInjuries)
      .leftJoin(people, eq(people.id, incidentInjuries.personId))
      .where(eq(incidentInjuries.incidentId, id))
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
    const linkedCAs = await tx
      .select()
      .from(correctiveActions)
      .where(
        and(eq(correctiveActions.sourceEntityType, 'incident'), eq(correctiveActions.sourceEntityId, id)),
      )
    const photos = await tx
      .select({
        link: incidentAttachments,
        attachment: attachments,
      })
      .from(incidentAttachments)
      .innerJoin(attachments, eq(attachments.id, incidentAttachments.attachmentId))
      .where(eq(incidentAttachments.incidentId, id))
    return { ...row, injuries, lostTime, involved, linkedCAs, photos }
  })

  if (!data) notFound()
  const { incident, site, department, supervisor, injuries, lostTime, involved, linkedCAs, photos } =
    data
  const activity = await recentActivityForEntity(ctx, 'incident', id, 25)
  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const basePath = `/incidents/${id}`
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
              {incident.locked ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/incidents/${id}/edit`}>
                <Button variant="outline" disabled={incident.locked}>
                  Edit
                </Button>
              </Link>
              <Link href={`/incidents/${id}/pdf`}>
                <Button variant="outline">
                  <FileText size={14} />
                  PDF
                </Button>
              </Link>
              <Link
                href={`/incidents/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}`}
                scroll={false}
              >
                <Button variant="outline">
                  <Mail size={14} /> Send email
                </Button>
              </Link>
              <form action={copyIncident} className="inline">
                <input type="hidden" name="id" value={id} />
                <Button variant="outline" type="submit">
                  <Copy size={14} /> Copy
                </Button>
              </form>
            </>
          }
        />
      }
      alerts={
        <>
          {incident.locked ? (
            <Alert variant="warning">
              <AlertTitle>This incident is locked</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Closed on {incident.closedAt ? new Date(incident.closedAt).toLocaleDateString() : '—'}.
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
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'medical', label: 'Medical' },
            { key: 'injuries', label: 'Injuries', count: injuries.length },
            { key: 'lost-time', label: 'Lost time', count: lostTime.length },
            { key: 'investigation', label: 'Investigation', count: linkedCAs.length },
            { key: 'photos', label: 'Photos & files', count: photos.length },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
        <Section title="General Information" subtitle="Who, what, where, when">
          <DetailGrid
            rows={[
              { label: 'Reference', value: <span className="font-mono">{incident.reference}</span> },
              { label: 'Type', value: incident.type.replace(/_/g, ' ') },
              { label: 'Occurred', value: new Date(incident.occurredAt).toLocaleString() },
              { label: 'Reported', value: new Date(incident.reportedAt).toLocaleString() },
              { label: 'Site', value: site?.name ?? '—' },
              { label: 'Location on site', value: incident.location ?? '—' },
              { label: 'Department', value: department?.name ?? '—' },
              { label: 'Weather', value: incident.weather ?? '—' },
              {
                label: 'Supervisor',
                value: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : '—',
              },
              { label: 'Foreman', value: incident.foremanText ?? '—' },
            ]}
          />
          <div className="mt-4 space-y-3 text-sm">
            <TextBlock label="People involved">
              {involved.length === 0 ? (
                <span className="text-slate-500">—</span>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {involved.map((row) => (
                    <li key={row.link.id}>
                      {row.person ? (
                        <Link
                          href={`/people/${row.person.id}`}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50"
                        >
                          {row.person.firstName} {row.person.lastName}
                        </Link>
                      ) : (
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs">
                          {row.link.personNameText}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TextBlock>
            <TextBlock label="Witnesses">
              {incident.witnesses ?? <span className="text-slate-500">—</span>}
            </TextBlock>
            <TextBlock label="External people involved">
              {incident.externalPeopleInvolved ?? <span className="text-slate-500">—</span>}
            </TextBlock>
            <TextBlock label="Events leading up to the incident">
              {incident.eventsLeadingUp ?? <span className="text-slate-500">—</span>}
            </TextBlock>
            <TextBlock label="Event details / cause">
              {incident.description ?? <span className="text-slate-500">—</span>}
            </TextBlock>
            <TextBlock label="Immediate action taken">
              {incident.immediateActionTaken ?? <span className="text-slate-500">—</span>}
            </TextBlock>
            <TextBlock label="PPE worn">
              {incident.ppeWorn ?? <span className="text-slate-500">—</span>}
            </TextBlock>
          </div>
        </Section>
        ) : null}

        {active === 'medical' ? (
        <>
        <Section
          title="Medical"
          subtitle="EMS, first aid, hospital, lost time / modified duty"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CheckIndicator checked={incident.criticalInjury} label="Critical injury" />
            <CheckIndicator
              checked={incident.ministryOfLabourNotified}
              label="Ministry of Labour notified"
            />
            <CheckIndicator checked={incident.emsNotified || incident.emsCalled} label="EMS called" />
            <CheckIndicator
              checked={incident.firstAidReceived || incident.firstAidGiven}
              label="First aid given"
            />
            <CheckIndicator
              checked={incident.medicalAttentionReceived}
              label="Medical attention received"
            />
            <CheckIndicator checked={incident.lostTime} label="Lost time" />
            <CheckIndicator checked={incident.modifiedDuty} label="Modified duty" />
            <CheckIndicator checked={incident.externallyReportable} label="Externally reportable" />
            <CheckIndicator checked={incident.policeNotified} label="Police notified" />
          </div>

          {/* EMS trail */}
          {incident.emsCalled || incident.emsNotified || incident.emsArrivedAt ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-rose-200 bg-rose-50/40 p-3 text-sm sm:grid-cols-2">
              <FieldRow label="EMS called">{yesNo(incident.emsCalled || incident.emsNotified)}</FieldRow>
              <FieldRow label="EMS arrived at">
                {incident.emsArrivedAt
                  ? new Date(incident.emsArrivedAt).toLocaleString()
                  : '—'}
              </FieldRow>
            </div>
          ) : null}

          {/* First-aid trail */}
          {incident.firstAidGiven || incident.firstAidReceived ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm sm:grid-cols-2">
              <FieldRow label="First aid provider">{incident.firstAidProvider ?? '—'}</FieldRow>
              <FieldRow label="First aid notes">{incident.firstAidNotes ?? '—'}</FieldRow>
            </div>
          ) : null}

          {/* Hospital trail */}
          {incident.medicalAttentionReceived ||
          incident.hospitalName ||
          incident.hospitalArrivedAt ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-sky-200 bg-sky-50/50 p-3 text-sm sm:grid-cols-2">
              <FieldRow label="Hospital">
                {incident.hospitalName ?? incident.treatedAtHospital ?? '—'}
              </FieldRow>
              <FieldRow label="City">{incident.treatedInCity ?? '—'}</FieldRow>
              <FieldRow label="Transportation">{incident.transportation ?? '—'}</FieldRow>
              <FieldRow label="Attending physician">
                {incident.attendingPhysician ?? '—'}
              </FieldRow>
              <FieldRow label="Hospital arrived">
                {incident.hospitalArrivedAt
                  ? new Date(incident.hospitalArrivedAt).toLocaleString()
                  : '—'}
              </FieldRow>
              <FieldRow label="Discharged">
                {incident.dischargedAt
                  ? new Date(incident.dischargedAt).toLocaleString()
                  : '—'}
              </FieldRow>
            </div>
          ) : null}

          {/* MOL trail */}
          {incident.ministryOfLabourNotified || incident.molNotifiedAt || incident.molReportNumber ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-orange-200 bg-orange-50/50 p-3 text-sm sm:grid-cols-2">
              <FieldRow label="MOL notified at">
                {incident.molNotifiedAt
                  ? new Date(incident.molNotifiedAt).toLocaleString()
                  : '—'}
              </FieldRow>
              <FieldRow label="MOL report number">{incident.molReportNumber ?? '—'}</FieldRow>
            </div>
          ) : null}

          {/* Police / insurance trail */}
          {incident.policeNotified ||
          incident.policeReportNumber ||
          incident.insuranceClaimNumber ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3 text-sm sm:grid-cols-2">
              <FieldRow label="Police report #">{incident.policeReportNumber ?? '—'}</FieldRow>
              <FieldRow label="Insurance claim #">
                {incident.insuranceClaimNumber ?? '—'}
              </FieldRow>
            </div>
          ) : null}

          {/* Damage estimate (always visible if set) */}
          {incident.damageEstimate ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
              <FieldRow label="Damage estimate (USD)">
                ${Number(incident.damageEstimate).toLocaleString()}
              </FieldRow>
            </div>
          ) : null}

          {/* Lost-time / modified-duty quick summary (full detail on the Lost time tab). */}
          {incident.lostTime || incident.modifiedDuty ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm sm:grid-cols-2">
              {incident.lostTime ? (
                <>
                  <FieldRow label="Lost time first day">{incident.lostTimeFirstDay ?? '—'}</FieldRow>
                  <FieldRow label="Lost time last day">{incident.lostTimeLastDay ?? 'still ongoing'}</FieldRow>
                  <FieldRow label="Total lost-time days">{incident.lostTimeDays ?? '—'}</FieldRow>
                </>
              ) : null}
              {incident.modifiedDuty ? (
                <>
                  <FieldRow label="Modified duty first day">{incident.modifiedDutyFirstDay ?? '—'}</FieldRow>
                  <FieldRow label="Modified duty last day">{incident.modifiedDutyLastDay ?? 'still ongoing'}</FieldRow>
                  <FieldRow label="Total modified-duty days">{incident.modifiedDutyDays ?? '—'}</FieldRow>
                </>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="Key Metrics" subtitle="Actual vs potential severity (1–5)">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <SeverityRating label="Actual severity" value={incident.actualSeverity} />
            <SeverityRating label="Potential severity" value={incident.potentialSeverity} />
            <SeverityRating label="Severity rating" value={incident.severityRating} />
          </div>
        </Section>
        </>
        ) : null}

        {active === 'injuries' ? (
        <>
        <Section title={`Injuries (${injuries.length})`} defaultOpen={injuries.length > 0}>
          {injuries.length === 0 ? (
            <p className="text-sm text-slate-500">No injuries recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {injuries.map((row) => (
                <li key={row.injury.id} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2">
                  <div>
                    <div className="font-medium">
                      {row.person ? (
                        <Link href={`/people/${row.person.id}`} className="hover:underline">
                          {row.person.firstName} {row.person.lastName}
                        </Link>
                      ) : (
                        row.injury.personName ?? '—'
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Body part(s): {row.injury.bodyParts.join(', ') || '—'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Injury type(s): {row.injury.injuryTypes.join(', ') || '—'}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">
                    {row.injury.treatment ? <p>{row.injury.treatment}</p> : null}
                    {row.injury.treatedAtFacility ? (
                      <p className="text-slate-500">Treated at: {row.injury.treatedAtFacility}</p>
                    ) : null}
                    {typeof row.injury.workedHoursPriorTo === 'number' ? (
                      <p className="text-slate-500">Hours worked prior: {row.injury.workedHoursPriorTo}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        </>
        ) : null}

        {active === 'lost-time' ? (
        <>
        <Section
          title={`Lost-time + modified-duty events (${lostTime.length})`}
          subtitle="Off-work / restricted / full-duty transitions with explicit date windows. Used by the DART rate report."
          defaultOpen={true}
        >
          {lostTime.length === 0 ? (
            <p className="text-sm text-slate-500">
              No lost-time tracking yet. Use the form below to record an off-work or restricted-duty window.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {lostTime.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">
                      {e.status === 'off_work' ? (
                        <Badge variant="destructive">Off work</Badge>
                      ) : e.status === 'restricted_duty' ? (
                        <Badge variant="warning">Restricted duty</Badge>
                      ) : (
                        <Badge variant="success">Full duty</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      <span className="font-mono">{e.validFrom}</span>
                      <span> → </span>
                      <span className="font-mono">{e.validTo ?? 'present'}</span>
                      {e.notes ? <span className="ml-2">· {e.notes}</span> : null}
                    </div>
                  </div>
                  {!incident.locked ? (
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
          {!incident.locked ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h4 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                Add lost-time / modified-duty row
              </h4>
              <LostTimeAddForm
                addAction={async (fd) => {
                  'use server'
                  fd.set('incidentId', id)
                  await addLostTimeEvent(fd)
                }}
                injuryOptions={injuries.map((row) => ({
                  id: row.injury.id,
                  label: row.person
                    ? `${row.person.firstName} ${row.person.lastName}`
                    : row.injury.personName ?? 'Unknown',
                }))}
              />
            </div>
          ) : null}
        </Section>
        </>
        ) : null}

        {active === 'investigation' ? (
        <>
        <Section title="Investigation" subtitle="Root cause + contributing factors">
          <div className="space-y-3 text-sm">
            <TextBlock label="Root cause">{incident.rootCause ?? <span className="text-slate-500">—</span>}</TextBlock>
            <TextBlock label="Contributing factors">
              {incident.contributingFactors.length > 0 ? (
                <ul className="list-disc pl-5">
                  {incident.contributingFactors.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </TextBlock>
          </div>
        </Section>

        <Section title={`Linked corrective actions (${linkedCAs.length})`} defaultOpen={true}>
          {linkedCAs.length === 0 ? (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>No corrective actions linked yet.</span>
              <Link
                href={`/corrective-actions/new?sourceEntityType=incident&sourceEntityId=${id}`}
                className="text-teal-700 hover:underline"
              >
                Create one →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {linkedCAs.map((ca) => (
                <li key={ca.id} className="flex items-center justify-between py-2">
                  <Link href={`/corrective-actions/${ca.id}`} className="font-medium hover:underline">
                    {ca.reference} · {ca.title}
                  </Link>
                  <Badge variant={ca.status === 'closed' ? 'success' : 'warning'}>{ca.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        </>
        ) : null}

        {active === 'photos' ? (
        <Section title={`Photos & files (${photos.length})`} defaultOpen={true}>
          <div className="space-y-3">
            <PhotoGallery photos={galleryPhotos} />
            {!incident.locked ? (
              <PhotoUploaderSection
                attachAction={async (ids) => {
                  'use server'
                  await attachPhotos(id, ids)
                }}
              />
            ) : null}
          </div>
        </Section>

        ) : null}

        {active === 'activity' ? (
        <Section title={`Activity (${activity.length})`} defaultOpen={true}>
          <ActivityFeed entries={activity} />
        </Section>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateStatus} className="flex items-end gap-3">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Move to</label>
                <Select name="status" defaultValue={incident.status}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit">Update</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <SendEmailDialog
        open={pickString(sp.send) === '1'}
        reference={incident.reference}
        defaultSubjectPrefix="Update"
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />
    </DetailPageLayout>
  )
}

function yesNo(b: boolean | null | undefined): string {
  return b ? 'Yes' : 'No'
}

function TextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-slate-900">{children}</div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{children}</span>
    </div>
  )
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
