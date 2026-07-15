import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { incidents } from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { incidentCreatedEvent } from '@beaconhs/integrations'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'
import { PageContainer } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { OccurredAtField } from './_occurred-at-field'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0f2b150c1cc651') }
}

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

async function reportIncident(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.create')
  const type = String(formData.get('type') ?? '') as (typeof TYPES)[number]
  const severity = String(formData.get('severity') ?? '') as (typeof SEVERITIES)[number]
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const location = String(formData.get('location') ?? '').trim() || null
  const weather = String(formData.get('weather') ?? '').trim() || null
  const immediateActionTaken = String(formData.get('immediateActionTaken') ?? '').trim() || null

  if (!TYPES.includes(type)) throw new Error('Invalid type')
  if (!SEVERITIES.includes(severity)) throw new Error('Invalid severity')
  if (!title) throw new Error('Title is required')
  if (!occurredAtRaw) throw new Error('Occurred date/time is required')
  const occurredAt = new Date(occurredAtRaw)
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid occurred date')

  const [row] = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'incident')
    const created = await tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type,
        severity,
        status: 'reported',
        title,
        description,
        occurredAt,
        siteOrgUnitId,
        location,
        weather,
        immediateActionTaken,
        reportedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning()
    const incident = created[0]
    if (incident) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'incident.created',
        subjectId: incident.id,
        dedupKey: `incident.created:${incident.id}`,
        payload: {
          notification: { kind: 'incident_reported', incidentId: incident.id },
          integration: incidentCreatedEvent(ctx.tenantId, {
            id: incident.id,
            reference: incident.reference,
            type,
            severity,
            status: 'reported',
            title,
            description,
            occurredAt,
            location,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: incident.id,
            moduleKey: 'incidents',
            event: 'on_create',
          }),
        },
      })
    }
    return created
  })

  revalidatePath('/incidents')
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: row.id,
      action: 'create',
      summary: `Reported ${row.reference}: ${title}`,
      after: { reference: row.reference, type, severity, occurredAt, siteOrgUnitId },
    })
    redirect(`/incidents/${row.id}`)
  }
  redirect('/incidents')
}

export default async function NewIncidentPage() {
  const tGenerated = await getGeneratedTranslations()
  await requireRequestContext()
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/incidents', label: 'Back to incidents' }}
          title={tGenerated('m_0f2b150c1cc651')}
        />
        <Alert variant="info">
          <AlertTitle>
            <GeneratedText id="m_100301e41d60fb" />
          </AlertTitle>
          <AlertDescription>
            <GeneratedText id="m_13bb38dc4c7071" />
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={reportIncident} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_074ba2f160c506')} required>
                  <Select name="type" defaultValue="injury">
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tGenerated('m_168b365cc671bf')} required>
                  <Select name="severity" defaultValue="no_injury">
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tGenerated('m_03f174df92cf82')} required className="sm:col-span-1">
                  <OccurredAtField name="occurredAt" />
                </Field>
                <Field label={tGenerated('m_020146dd3d3d5a')}>
                  <RemoteSelectField
                    lookup="incident-sites"
                    name="siteOrgUnitId"
                    placeholder={tGenerated('m_015c668f21e7b9')}
                    searchPlaceholder={tGenerated('m_1931aa93098220')}
                    sheetTitle="Select a site"
                    emptyLabel="—"
                  />
                </Field>
                <Field label={tGenerated('m_0decefd558c355')} required className="sm:col-span-2">
                  <Input name="title" required placeholder={tGenerated('m_07b6683aca592d')} />
                </Field>
                <Field label={tGenerated('m_14d923495cf14c')} className="sm:col-span-2">
                  <Textarea
                    name="description"
                    rows={4}
                    placeholder={tGenerated('m_1d61db803523a6')}
                  />
                </Field>
                <Field label={tGenerated('m_0352b4ecd48a3a')}>
                  <Input name="location" placeholder={tGenerated('m_01b3e003b5a98b')} />
                </Field>
                <Field label={tGenerated('m_0ac9b805dc5093')}>
                  <Input name="weather" placeholder={tGenerated('m_0cadbe8ae1ae4e')} />
                </Field>
                <Field label={tGenerated('m_1ea890e56aa6ae')} className="sm:col-span-2">
                  <Textarea
                    name="immediateActionTaken"
                    rows={3}
                    placeholder={tGenerated('m_08cccd47bcda61')}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">
                  <GeneratedText id="m_09349052137c88" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
