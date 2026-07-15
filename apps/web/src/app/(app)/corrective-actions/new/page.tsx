import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
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
import { correctiveActions, incidents } from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { correctiveActionCreatedEvent } from '@beaconhs/integrations'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { nextReference } from '@/lib/reference'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_16b0371ad9cc2c') }
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const SOURCES = [
  'inspection',
  'incident',
  'near_miss',
  'observation',
  'audit',
  'jsha',
  'other',
] as const

async function createCA(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.create')
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

  const row = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')
    const created = await tx
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
    const correctiveAction = created[0]
    if (correctiveAction) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.created',
        subjectId: correctiveAction.id,
        dedupKey: `corrective_action.created:${correctiveAction.id}`,
        payload: {
          notification: { kind: 'corrective_action_assigned', caId: correctiveAction.id },
          integration: correctiveActionCreatedEvent(ctx.tenantId, {
            id: correctiveAction.id,
            reference: correctiveAction.reference,
            title,
            status: 'open',
            severity,
            source,
            dueOn,
            assignedOn,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: correctiveAction.id,
            moduleKey: 'corrective-actions',
            event: 'on_create',
          }),
        },
      })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'corrective_action',
        entityId: correctiveAction.id,
        action: 'create',
        summary: `Created ${correctiveAction.reference}: ${title}`,
        after: { reference: correctiveAction.reference, severity, source, dueOn, siteOrgUnitId },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'corrective_action',
        targetRef: {},
      })
    }
    return correctiveAction ?? null
  })
  revalidatePath('/corrective-actions')
  if (row) {
    redirect(`/corrective-actions/${row.id}`)
  }
  redirect('/corrective-actions')
}

export default async function NewCAPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const presetSourceType = pickString(sp.sourceEntityType)
  const presetSourceId = pickString(sp.sourceEntityId)
  const ctx = await requireRequestContext()

  const sourceIncident = await ctx.db(async (tx) => {
    let inc = null
    if (presetSourceType === 'incident' && presetSourceId) {
      const [i] = await tx.select().from(incidents).where(eq(incidents.id, presetSourceId)).limit(1)
      inc = i ?? null
    }
    return inc
  })

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/corrective-actions', label: 'Back to corrective actions' }}
          title={tGenerated('m_16b0371ad9cc2c')}
        />
        <GeneratedValue
          value={
            sourceIncident ? (
              <Alert variant="info">
                <AlertTitle>
                  <GeneratedText id="m_0bbef5a046ab0a" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedValue value={sourceIncident.reference} /> ·{' '}
                  <GeneratedValue value={sourceIncident.title} />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createCA} className="space-y-4">
              <input type="hidden" name="sourceEntityId" value={presetSourceId ?? ''} />
              <input type="hidden" name="sourceEntityType" value={presetSourceType ?? ''} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_0decefd558c355')} required className="sm:col-span-2">
                  <Input name="title" required placeholder={tGenerated('m_0915692fccfff8')} />
                </Field>
                <Field label={tGenerated('m_14d923495cf14c')} className="sm:col-span-2">
                  <Textarea
                    name="description"
                    rows={3}
                    placeholder={tGenerated('m_1d4bdebb9135a7')}
                  />
                </Field>
                <Field label={tGenerated('m_168b365cc671bf')} required>
                  <Select name="severity" defaultValue="medium">
                    <GeneratedValue
                      value={SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          <GeneratedValue value={s} />
                        </option>
                      ))}
                    />
                  </Select>
                </Field>
                <Field label={tGenerated('m_1d05fa7a091a9b')}>
                  <Select name="source" defaultValue={presetSourceType ?? 'observation'}>
                    <GeneratedValue
                      value={SOURCES.map((s) => (
                        <option key={s} value={s}>
                          <GeneratedValue value={s.replace('_', ' ')} />
                        </option>
                      ))}
                    />
                  </Select>
                </Field>
                <Field label={tGenerated('m_020146dd3d3d5a')}>
                  <RemoteSelectField
                    lookup="corrective-action-sites"
                    name="siteOrgUnitId"
                    placeholder={tGenerated('m_015c668f21e7b9')}
                    searchPlaceholder={tGenerated('m_1931aa93098220')}
                    sheetTitle="Select a site"
                    emptyLabel="—"
                  />
                </Field>
                <Field label={tGenerated('m_04bfc1eaee3a4b')}>
                  <Input name="dueOn" type="date" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">
                  <GeneratedText id="m_0db5c2019349bf" />
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
