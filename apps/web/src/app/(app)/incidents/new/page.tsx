import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, count, eq, sql } from 'drizzle-orm'
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
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { emitIncidentReported } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Report incident' }

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
    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(sql`extract(year from ${incidents.occurredAt}) = ${year}`)
    const reference = `INC-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
    return tx
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
    // Fire-and-forget notification; the emit function never throws.
    await emitIncidentReported(ctx, { incidentId: row.id })
    await runModuleFlows(ctx, { moduleKey: 'incidents', event: 'on_create', subjectId: row.id })
    redirect(`/incidents/${row.id}`)
  }
  redirect('/incidents')
}

export default async function NewIncidentPage() {
  const ctx = await requireRequestContext()
  const sites = await ctx.db((tx) =>
    tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name)),
  )
  const nowLocal = new Date().toISOString().slice(0, 16)

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/incidents', label: 'Back to incidents' }}
          title="Report incident"
        />
        <Alert variant="info">
          <AlertTitle>Quick report</AlertTitle>
          <AlertDescription>
            Use this form to capture the essentials. Photos, witness statements, and the full
            investigation form happen on the incident's detail page after submission.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={reportIncident} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Type" required>
                  <Select name="type" defaultValue="injury">
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Severity" required>
                  <Select name="severity" defaultValue="no_injury">
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Occurred at" required className="sm:col-span-1">
                  <Input name="occurredAt" type="datetime-local" required defaultValue={nowLocal} />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Title" required className="sm:col-span-2">
                  <Input
                    name="title"
                    required
                    placeholder="Short summary, e.g. ‘Slip on wet floor near pump 3’"
                  />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea
                    name="description"
                    rows={4}
                    placeholder="What happened? Witnesses? Equipment involved?"
                  />
                </Field>
                <Field label="Specific location">
                  <Input name="location" placeholder="Building / area / coordinates" />
                </Field>
                <Field label="Weather">
                  <Input name="weather" placeholder="Optional" />
                </Field>
                <Field label="Immediate action taken" className="sm:col-span-2">
                  <Textarea
                    name="immediateActionTaken"
                    rows={3}
                    placeholder="First aid given, area barricaded, equipment locked out, etc."
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Submit report</Button>
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
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
