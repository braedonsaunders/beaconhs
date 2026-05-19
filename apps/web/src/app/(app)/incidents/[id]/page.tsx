import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import { AlertTriangle, FileText, Lock, Unlock } from 'lucide-react'
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
import { SeverityBadge, StatusBadge } from '../page'

export const dynamic = 'force-dynamic'

const STATUSES = ['reported', 'under_investigation', 'pending_review', 'closed', 'reopened'] as const

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return
  const closing = status === 'closed'
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
    action: closing ? 'update' : 'update',
    summary: `Status changed to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Incident · ${id.slice(0, 8)}` }
}

const INCIDENT_TABS = ['overview', 'medical', 'injuries', 'investigation', 'photos', 'activity'] as const
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
            { key: 'injuries', label: 'Injuries', count: injuries.length + lostTime.length },
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
          subtitle="Injury detail, EMS / MOL, first aid, lost time, modified duty"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CheckIndicator checked={incident.criticalInjury} label="Critical injury" />
            <CheckIndicator
              checked={incident.ministryOfLabourNotified}
              label="Ministry of Labour notified"
            />
            <CheckIndicator checked={incident.emsNotified} label="EMS notified" />
            <CheckIndicator checked={incident.firstAidReceived} label="First aid received" />
            <CheckIndicator
              checked={incident.medicalAttentionReceived}
              label="Medical attention received"
            />
            <CheckIndicator checked={incident.lostTime} label="Lost time" />
            <CheckIndicator checked={incident.modifiedDuty} label="Modified duty" />
            <CheckIndicator checked={incident.externallyReportable} label="Externally reportable" />
          </div>

          {incident.firstAidReceived || incident.medicalAttentionReceived ? (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm sm:grid-cols-2">
              {incident.firstAidReceived ? (
                <FieldRow label="First aid provider">{incident.firstAidProvider ?? '—'}</FieldRow>
              ) : null}
              {incident.medicalAttentionReceived ? (
                <>
                  <FieldRow label="Treated at">{incident.treatedAtHospital ?? '—'}</FieldRow>
                  <FieldRow label="City">{incident.treatedInCity ?? '—'}</FieldRow>
                  <FieldRow label="Transportation">{incident.transportation ?? '—'}</FieldRow>
                </>
              ) : null}
            </div>
          ) : null}

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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SeverityRating label="Actual severity" value={incident.actualSeverity} />
            <SeverityRating label="Potential severity" value={incident.potentialSeverity} />
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

        <Section title={`Lost time events (${lostTime.length})`} defaultOpen={lostTime.length > 0}>
          {lostTime.length === 0 ? (
            <p className="text-sm text-slate-500">No lost-time tracking yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {lostTime.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{e.status.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-slate-500">
                    {e.validFrom} {e.validTo ? `→ ${e.validTo}` : '→ present'}
                    {e.notes ? ` · ${e.notes}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
    </DetailPageLayout>
  )
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
