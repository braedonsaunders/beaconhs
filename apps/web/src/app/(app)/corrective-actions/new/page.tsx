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
import { correctiveActions, incidents, orgUnits } from '@beaconhs/db/schema'
import { emitCorrectiveActionAssigned } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New corrective action' }

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SOURCES = ['inspection', 'incident', 'near_miss', 'observation', 'audit', 'jsha', 'other'] as const

async function createCA(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) throw new Error('Title is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const severity = String(formData.get('severity') ?? 'medium') as (typeof SEVERITIES)[number]
  const source = String(formData.get('source') ?? 'observation') as (typeof SOURCES)[number]
  const sourceEntityId = String(formData.get('sourceEntityId') ?? '').trim() || null
  const sourceEntityType = String(formData.get('sourceEntityType') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const dueOn = String(formData.get('dueOn') ?? '').trim() || null
  const assignedOn = new Date().toISOString().slice(0, 10)

  const [row] = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const [{ c }] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`)
    const reference = `CA-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
    return tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title,
        description,
        severity,
        status: 'open',
        source,
        sourceEntityType,
        sourceEntityId,
        siteOrgUnitId,
        assignedOn,
        dueOn,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
      })
      .returning()
  })
  revalidatePath('/corrective-actions')
  if (row) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: row.id,
      action: 'create',
      summary: `Created ${row.reference}: ${title}`,
      after: { reference: row.reference, severity, source, dueOn, siteOrgUnitId },
    })
    await emitCorrectiveActionAssigned(ctx, {
      caId: row.id,
      assigneeUserId: null,
      assignerUserId: null,
    })
    redirect(`/corrective-actions/${row.id}`)
  }
  redirect('/corrective-actions')
}

export default async function NewCAPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetSourceType = pickString(sp.sourceEntityType)
  const presetSourceId = pickString(sp.sourceEntityId)
  const ctx = await requireRequestContext()

  const [sites, sourceIncident] = await ctx.db(async (tx) => {
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    let inc = null
    if (presetSourceType === 'incident' && presetSourceId) {
      const [i] = await tx.select().from(incidents).where(eq(incidents.id, presetSourceId)).limit(1)
      inc = i ?? null
    }
    return [s, inc] as const
  })

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader back={{ href: '/corrective-actions', label: 'Back to corrective actions' }} title="New corrective action" />
        {sourceIncident ? (
          <Alert variant="info">
            <AlertTitle>Linked to incident</AlertTitle>
            <AlertDescription>
              {sourceIncident.reference} · {sourceIncident.title}
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="pt-6">
            <form action={createCA} className="space-y-4">
              <input type="hidden" name="sourceEntityId" value={presetSourceId ?? ''} />
              <input type="hidden" name="sourceEntityType" value={presetSourceType ?? ''} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Title" required className="sm:col-span-2">
                  <Input name="title" required placeholder="What needs to be done?" />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea name="description" rows={3} placeholder="Context, scope, expected outcome" />
                </Field>
                <Field label="Severity" required>
                  <Select name="severity" defaultValue="medium">
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Source">
                  <Select name="source" defaultValue={presetSourceType ?? 'observation'}>
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
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
                <Field label="Due on">
                  <Input name="dueOn" type="date" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create action</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
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
