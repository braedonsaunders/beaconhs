import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Edit incident · ${id.slice(0, 8)}` }
}

async function updateIncident(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const type = String(formData.get('type') ?? '') as (typeof TYPES)[number]
  const severity = String(formData.get('severity') ?? '') as (typeof SEVERITIES)[number]
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const location = String(formData.get('location') ?? '').trim() || null
  const weather = String(formData.get('weather') ?? '').trim() || null
  const witnesses = String(formData.get('witnesses') ?? '').trim() || null
  const externalPeopleInvolved = String(formData.get('externalPeopleInvolved') ?? '').trim() || null
  const eventsLeadingUp = String(formData.get('eventsLeadingUp') ?? '').trim() || null
  const immediateActionTaken = String(formData.get('immediateActionTaken') ?? '').trim() || null
  const ppeWorn = String(formData.get('ppeWorn') ?? '').trim() || null

  if (!TYPES.includes(type)) return
  if (!SEVERITIES.includes(severity)) return
  if (!title) return
  if (!occurredAtRaw) return
  const occurredAt = new Date(occurredAtRaw)
  if (Number.isNaN(occurredAt.getTime())) return

  const before = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, id)).limit(1)
    return row ?? null
  })
  if (!before) return
  if (before.locked) return

  await ctx.db((tx) =>
    tx
      .update(incidents)
      .set({
        type,
        severity,
        title,
        description,
        occurredAt,
        siteOrgUnitId,
        location,
        weather,
        witnesses,
        externalPeopleInvolved,
        eventsLeadingUp,
        immediateActionTaken,
        ppeWorn,
      })
      .where(eq(incidents.id, id)),
  )

  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: 'Incident details edited',
    before: {
      type: before.type,
      severity: before.severity,
      title: before.title,
      occurredAt: before.occurredAt,
    },
    after: { type, severity, title, occurredAt },
  })

  revalidatePath(`/incidents/${id}`)
  revalidatePath('/incidents')
  redirect(`/incidents/${id}`)
}

export default async function EditIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [inc] = await tx.select().from(incidents).where(eq(incidents.id, id)).limit(1)
    if (!inc) return null
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return { inc, sites }
  })
  if (!data) notFound()
  const { inc, sites } = data
  const occurredAtLocal = new Date(inc.occurredAt).toISOString().slice(0, 16)

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={`Edit ${inc.reference}`}
          description="Update the incident details. Status changes, photos, injuries, investigation and CAs are managed from the detail page."
          back={{ href: `/incidents/${id}`, label: 'Back to incident' }}
        />
        {inc.locked ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This incident is <strong>locked</strong>. Unlock it from the detail page before editing.
          </div>
        ) : null}
        <form
          action={updateIncident}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required defaultValue={inc.title} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <Select id="type" name="type" defaultValue={inc.type}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="severity">Severity</Label>
              <Select id="severity" name="severity" defaultValue={inc.severity}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="occurredAt">Occurred at *</Label>
              <Input
                id="occurredAt"
                name="occurredAt"
                type="datetime-local"
                required
                defaultValue={occurredAtLocal}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="siteOrgUnitId">Site</Label>
              <Select
                id="siteOrgUnitId"
                name="siteOrgUnitId"
                defaultValue={inc.siteOrgUnitId ?? ''}
              >
                <option value="">— None —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location on site</Label>
              <Input id="location" name="location" defaultValue={inc.location ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weather">Weather</Label>
              <Input id="weather" name="weather" defaultValue={inc.weather ?? ''} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description / event details</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={inc.description ?? ''}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="witnesses">Witnesses</Label>
              <Textarea
                id="witnesses"
                name="witnesses"
                rows={2}
                defaultValue={inc.witnesses ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="externalPeopleInvolved">External people involved</Label>
              <Textarea
                id="externalPeopleInvolved"
                name="externalPeopleInvolved"
                rows={2}
                defaultValue={inc.externalPeopleInvolved ?? ''}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eventsLeadingUp">Events leading up to the incident</Label>
            <Textarea
              id="eventsLeadingUp"
              name="eventsLeadingUp"
              rows={3}
              defaultValue={inc.eventsLeadingUp ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="immediateActionTaken">Immediate action taken</Label>
            <Textarea
              id="immediateActionTaken"
              name="immediateActionTaken"
              rows={3}
              defaultValue={inc.immediateActionTaken ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ppeWorn">PPE worn</Label>
            <Input id="ppeWorn" name="ppeWorn" defaultValue={inc.ppeWorn ?? ''} />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href={`/incidents/${id}`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={inc.locked}>
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
